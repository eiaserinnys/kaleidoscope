(() => {
  const client = window.kaleidoscope;
  for (const [action, value] of [["first", "첫 번째"], ["second", "두 번째"]]) {
    client.handle(action, async () => {
      try {
        const result = await client.process.start({
          key: action, permission: "run", cwd_permission: "work",
          spec: { name: "시험 프로그램", command: "python3", args: ["-c", "import pathlib,sys; pathlib.Path('result.txt').write_text(sys.argv[1], encoding='utf-8')", value], env: {} },
        });
        client.publish({ status: result.status === "cancelled" ? "취소됨" : `${value} 실행됨` });
      } catch (error) { client.publish({ status: `${error.id || "오류"}: ${error.message}` }); }
    });
  }
})();
