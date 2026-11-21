#!/usr/bin/env python3
"""Run the DocuLens MApp release smoke test through Appium/XCUITest."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

HOST = "org.linuxdo.community"
FILES = "com.apple.DocumentsApp"
ELEMENT = "element-6066-11e4-a52e-4f735466cecf"
REPO = Path(__file__).resolve().parents[1]


class Device:
    def __init__(self, server, capabilities):
        self.server = server.rstrip("/")
        self.session = ""
        response = self.request("/session", {"capabilities": {"alwaysMatch": capabilities}})
        self.session = "/session/" + response["sessionId"]
        self.capabilities = response.get("capabilities", {})

    def request(self, path, data=None, method=None):
        request = Request(
            self.server + self.session + path,
            data=None if data is None else json.dumps(data).encode(),
            headers={"Content-Type": "application/json"},
            method=method,
        )
        try:
            with urlopen(request, timeout=150) as response:
                return json.load(response)["value"]
        except HTTPError as error:
            raise RuntimeError(json.load(error)["value"]["message"].splitlines()[0]) from error

    def mobile(self, command, **arguments):
        return self.request("/execute/sync", {"script": "mobile: " + command, "args": [arguments]})

    def settings(self, app):
        self.request("/appium/settings", {"settings": {
            "defaultActiveApplication": app, "snapshotMaxDepth": 50, "waitForIdleTimeout": 1,
        }})

    def elements(self):
        return list(ET.fromstring(self.request("/source")).iter())

    def find(self, name):
        matches = self.request("/elements", {"using": "accessibility id", "value": name})
        return matches[0][ELEMENT] if matches else None

    def click(self, name):
        element = wait_for(lambda: self.find(name), name)
        self.request("/element/" + element + "/click", {})

    def enter(self, name, value, clear=False):
        element = wait_for(lambda: self.find(name), name)
        if clear:
            self.request("/element/" + element + "/clear", {})
        self.request("/element/" + element + "/value", {"text": value, "value": list(value)})

    def reveal(self, name, direction="up", kind=None):
        for _ in range(7):
            elements = self.elements()
            candidates = [
                e for e in elements if e.get("name") == name
                and (kind is None or e.tag == "XCUIElementType" + kind)
                and int(e.get("height", "0")) > 0
            ]
            for element in candidates:
                if element.get("visible") == "true":
                    return element
            if candidates:
                direction = "down" if int(candidates[0].get("y", "0")) < 0 else "up"
            self.mobile("swipe", direction=direction)
        raise RuntimeError(f"Cannot reveal {name}")

    def tap(self, element):
        x, y, width, height = (int(element.get(key)) for key in ("x", "y", "width", "height"))
        self.mobile("tap", x=x + width // 2, y=y + height // 2)

    def diagnostics(self):
        return max((element.get(key, "") for element in self.elements()
                    for key in ("label", "value")
                    if "OpenCV 初始化完成" in element.get(key, "")), key=len, default="")

    def open_diagnostics(self):
        if not self.diagnostics():
            self.click_after_reveal("诊断日志")
        wait_for(self.diagnostics, "OpenCV initialization log")

    def expect_log(self, pattern, previous=0):
        return wait_for(
            lambda: re.findall(pattern, self.diagnostics(), re.MULTILINE)[previous:] or None,
            pattern,
        )[-1]

    def select_format(self, label, expected_log):
        previous = len(re.findall(expected_log, self.diagnostics()))
        self.tap(self.reveal("导出格式", direction="down", kind="Other"))
        self.click(label)
        self.expect_log(expected_log, previous)

    def load_fixture(self, fixture, reveal=True):
        if reveal:
            self.reveal("选择照片", direction="down", kind="Button")
        self.click("选择照片")
        self.click("选取文件")
        self.click("最近项目")
        self.click(fixture)
        filename, extension = fixture.rsplit(", ", 1)
        wait_for(lambda: any(
            re.search(re.escape(filename + "." + extension) + r" · [\d.]+ MiB", e.get("label", ""))
            for e in self.elements()
        ), "fixture filename and size")
        wait_for(lambda: any(
            e.get("name") == "生成扫描件" and e.get("enabled") == "true"
            for e in self.elements()
        ), "enabled scan button")
        self.click("生成扫描件")

    def save(self, stem, extension, deny=False):
        message = "保存失败：USER_CANCELLED" if deny else f"已请求保存 doculens-scan.{extension}"
        previous = self.diagnostics().count(message)
        self.click_after_reveal("保存扫描件")
        if deny:
            self.click("miniapp-authorize-deny")
        else:
            self.click("miniapp-authorize-allow")
            self.enter("DOCPicker.filenameTextField", stem, clear=True)
            self.click("DOCPicker.actionButton")
        self.expect_log(re.escape(message), previous)

    def click_after_reveal(self, name, direction="up"):
        self.reveal(name, direction, kind="Button")
        self.click(name)

    def verify_files(self, stem):
        self.mobile("activateApp", bundleId=FILES)
        self.settings(FILES)
        self.click("最近项目")
        self.click("搜索")
        self.enter("搜索", stem)
        expected = {f"{stem}, {extension}" for extension in ("jpg", "png", "pdf")}
        wait_for(lambda: expected <= {e.get("name") for e in self.elements()}, "three saved files")


def wait_for(check, description, timeout=24):
    end = time.monotonic() + timeout
    while True:
        value = check()
        if value:
            return value
        if time.monotonic() >= end:
            raise RuntimeError(f"Timed out waiting for {description}")
        time.sleep(.35)


def verify_pdf(path, width, height):
    wait_for(path.is_file, f"PDF synced to {path}", timeout=60)
    subprocess.run(["node", "--input-type=module", "-e", """
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
const [path, width, height] = process.argv.slice(1);
const pdf = await PDFDocument.load(await readFile(path));
if (pdf.getPageCount() !== 1) throw Error('Expected a single PDF page');
const page = pdf.getPage(0).getSize();
if (Math.abs(page.width / page.height / (width / height) - 1) > 0.005) {
  throw Error('PDF page ratio differs from the scan');
}
""", str(path.resolve()), str(width), str(height)], cwd=REPO, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sandbox", required=True, help="Ready LINUX DO sandbox URL")
    parser.add_argument("--udid", required=True)
    parser.add_argument("--team", default=os.getenv("MAPP_XCODE_TEAM"))
    parser.add_argument("--wda-bundle-id", default=os.getenv("MAPP_WDA_BUNDLE_ID"))
    parser.add_argument("--server", default="http://127.0.0.1:4729")
    parser.add_argument("--jpeg-fixture", default="doculens-test-12mp, jpg",
                        help="Exact iOS Files accessibility name, without extension before the comma")
    parser.add_argument("--smartdoc-fixture", default="datasheet001-02, png")
    parser.add_argument("--pdf-dir", type=Path, help="Mac directory synced with the iPhone save location")
    parser.add_argument("--report-dir", type=Path, default=Path("/tmp/doculens-mapp-reports"))
    args = parser.parse_args()
    url = urlsplit(args.sandbox)
    if (url.scheme, url.netloc) != ("https", "linux.do") or not re.fullmatch(
        r"/apps-sandbox/01a1f801-1869-7a35-a7a2-b72ae4d4d7f8/[^/]+-[a-f0-9]{8}", url.path
    ):
        parser.error("--sandbox must be a DocuLens LINUX DO sandbox build URL")

    stem = "doculens-regression-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    report = args.report_dir / stem
    report.mkdir(parents=True)
    print(f"Test output name: {stem}\nReport: {report}", flush=True)
    caps = {"platformName": "iOS", "appium:automationName": "XCUITest",
            "appium:bundleId": HOST, "appium:udid": args.udid, "appium:noReset": True,
            "appium:forceAppLaunch": True,
            "appium:wdaLaunchTimeout": 120000, "appium:allowProvisioningUpdates": True}
    if args.team:
        caps.update({"appium:xcodeOrgId": args.team, "appium:xcodeSigningId": "Apple Development"})
    if args.wda_bundle_id:
        caps["appium:updatedWDABundleId"] = args.wda_bundle_id

    device = Device(args.server, caps)
    try:
        host = device.mobile("listApps", returnAttributes=[
            "CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion",
        ]).get(HOST, {})
        (report / "run.json").write_text(json.dumps({
            "sandbox": args.sandbox, "host": HOST,
            "hostVersion": host.get("CFBundleShortVersionString"),
            "hostBuild": host.get("CFBundleVersion"),
            "platformVersion": device.capabilities.get("platformVersion"),
        }, indent=2) + "\n")
        device.settings(HOST)
        device.mobile("deepLink", url=args.sandbox, bundleId=HOST)
        # Click as soon as available. This checks the flow even when initialization wins the race.
        device.load_fixture(args.jpeg_fixture, reveal=False)
        device.open_diagnostics()
        device.expect_log(r"Worker 正在处理 4000×3000")
        device.expect_log(r"未找到完整纸边，已保留整张照片")
        device.expect_log(r"JPEG 准备完成")
        wait_for(lambda: any(e.get("label") == "4000 × 3000" for e in device.elements()), "full-size result")
        (report / "12mp.log").write_text(device.diagnostics() + "\n")
        print("PASS: background initialization and full-resolution JPEG scan", flush=True)

        device.load_fixture(args.smartdoc_fixture)
        device.open_diagnostics()
        device.expect_log(r"Worker 正在处理 1920×1080")
        device.expect_log(r"文件已准备；请核对裁切范围")
        cropped = wait_for(lambda: next((
            e.get("label") for e in device.elements()
            if re.fullmatch(r"\d+ × \d+", e.get("label", "")) and e.get("label") != "1920 × 1080"
        ), None), "cropped scan dimensions")
        width, height = cropped.split(" × ")
        device.save(stem, "jpg")
        device.select_format("PNG", r"PNG 准备完成")
        device.save(stem, "png")
        device.select_format("单页 PDF", r"PDF 准备完成")
        pages, page_width, page_height = device.expect_log(
            r"PDF 页面：(\d+) 页，([\d.]+) × ([\d.]+) pt"
        )
        if pages != "1" or abs(float(page_width) / float(page_height) / (int(width) / int(height)) - 1) > .005:
            raise RuntimeError(f"Unexpected PDF page geometry for scan {cropped}")
        print("PASS: generated PDF page count and aspect ratio in diagnostics")
        device.select_format("PNG", r"PNG 复用导出文件")
        device.select_format("单页 PDF", r"PDF 复用导出文件")
        device.save(stem, "pdf", deny=True)
        device.save(stem, "pdf")
        previous = device.diagnostics().count("PDF 准备完成")
        device.click_after_reveal("旋转 90°", direction="down")
        device.expect_log(r"PDF 准备完成", previous)
        (report / "smartdoc.log").write_text(device.diagnostics() + "\n")
        device.verify_files(stem)
        print(f"PASS: SmartDoc crop {cropped}, three saved files, cache reuse, rotation and denial recovery")
        if args.pdf_dir:
            verify_pdf(args.pdf_dir / (stem + ".pdf"), width, height)
            print("PASS: PDF page count and aspect ratio")
        else:
            print("PENDING: independent verification of the saved PDF (supply --pdf-dir)")
        print("Manual checks: cropped preview retains text and rotated output orientation")
    finally:
        try:
            device.request("", method="DELETE")
        except (RuntimeError, OSError) as error:
            print(f"Appium session cleanup failed: {error}", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"FAIL: {error}")
