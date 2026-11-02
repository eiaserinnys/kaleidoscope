// 이 파일을 localized-form 자산 1판으로 등록한 뒤 예제 정의를 올립니다.
(() => {
  const client = window.kaleidoscope;
  const languageOptions = {
    ko: [
      { value: "ko", label: "한국어" },
      { value: "en", label: "영어" },
      { value: "ja", label: "일본어" },
    ],
    en: [
      { value: "ko", label: "Korean" },
      { value: "en", label: "English" },
      { value: "ja", label: "Japanese" },
    ],
    ja: [
      { value: "ko", label: "韓国語" },
      { value: "en", label: "英語" },
      { value: "ja", label: "日本語" },
    ],
  };
  const publish = (inputs = client.inputs) => {
    const language = inputs.language?.status === "ready" && typeof inputs.language.value === "string"
      ? inputs.language.value
      : "ko";
    client.publish({ language_options: languageOptions[language] ?? languageOptions.ko });
  };
  publish();
  client.onInputs((inputs, changed) => {
    if (changed.includes("language")) publish(inputs);
  });
})();
