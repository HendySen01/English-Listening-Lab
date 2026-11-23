import { selectAccessMode } from "./runtimeMode.ts";

const failures: string[] = [];
function check(name: string, condition: boolean) {
  if (!condition) failures.push(name);
  else console.log(`通过 ${name}`);
}

check("[前端] 受保护构建在健康检查失败时仍要求登录", selectAccessMode(true, false) === "protected");
check("[前端] 本地开发缺少健康检查时保持单用户页面", selectAccessMode(false, false) === "local");
check("[前端] 本地开发发现多用户健康检查时要求登录", selectAccessMode(false, true) === "protected");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("runtime mode ok");
