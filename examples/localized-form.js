// 이 파일을 localized-form 자산 1판으로 등록한 뒤 예제 정의를 올립니다.
(() => {
  const client = window.kaleidoscope;
  const options = {
    ko: {
      language: [
        { value: "ko", label: "한국어" },
        { value: "en", label: "English" },
        { value: "ja", label: "日本語" },
      ],
      choice: [
        { value: "one", label: "첫째" },
        { value: "two", label: "둘째" },
      ],
    },
    en: {
      language: [
        { value: "ko", label: "Korean" },
        { value: "en", label: "English" },
        { value: "ja", label: "Japanese" },
      ],
      choice: [
        { value: "one", label: "First" },
        { value: "two", label: "Second" },
      ],
    },
    ja: {
      language: [
        { value: "ko", label: "韓国語" },
        { value: "en", label: "英語" },
        { value: "ja", label: "日本語" },
      ],
      choice: [
        { value: "one", label: "一つ目" },
        { value: "two", label: "二つ目" },
      ],
    },
  };
  const publish = (inputs = client.inputs) => {
    const language = inputs.language?.status === "ready" && typeof inputs.language.value === "string"
      ? inputs.language.value
      : "ko";
    const selected = options[language] ?? options.ko;
    client.publish({
      language_options: selected.language,
      choice_options: selected.choice,
    });
  };
  publish();
  client.onInputs((inputs, changed) => {
    if (changed.includes("language")) publish(inputs);
  });
})();
