// 当前 8787 使用的单用户业务客户端。
// Schema 是 prisma/schema.prisma，连接只来自 DATABASE_URL。
// 不得改成多用户 Schema，也不得连接认证库。
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
