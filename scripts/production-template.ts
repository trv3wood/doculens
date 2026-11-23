const DEV_ONLY_BLOCK =
  /\n?[ \t]*<!--\s*diagnostics:dev-only:start\s*-->[\s\S]*?<!--\s*diagnostics:dev-only:end\s*-->\n?/g;

/** 生成正式包使用的模板：移除只在开发服务器保留的诊断日志控件。 */
export function productionTemplate(template: string) {
  const result = template.replace(DEV_ONLY_BLOCK, "\n");
  if (/id="log"|class="diagnostics"|diagnostics:dev-only/.test(result)) {
    throw new Error("生产模板仍包含诊断日志控件，请检查 dev-only 标记");
  }
  return result;
}
