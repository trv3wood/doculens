import { resolve } from "node:path";
import { writeFixtures } from "./fixtures";

export default async function globalSetup() {
  writeFixtures(resolve("testdata/generated"));
}
