import { defineConfig } from "vitest/config";

export default defineConfig({
  // git을 실제로 호출하는 테스트는 Windows에서 병렬 부하가 크면 기본 5초를 넘긴다.
  test: { include: ["test/**/*.test.ts"], testTimeout: 20_000 },
});
