## 화면 폭 줄바꿈 표본

주소: https://example.com/this/is/a/long/path/that/needs/to/wrap/without/overflowing/the/window/at/small/widths?query=longvalue

인라인 주소 코드: `https://example.com/this/is/a/very/long/inline/code/url/that/must/wrap/without/causing/overflow`

공백 없는 문자열: kaleidoscope텍스트줄바꿈검증용긴문자열공백없이계속이어지는문장kaliedoscope텍스트줄바꿈검증용긴문자열공백없이계속이어지는문장kaleidoscope텍스트줄바꿈검증용긴문자열공백없이계속이어지는문장kaleidoscope텍스트줄바꿈검증용긴문자열공백없이계속이어지는문장

> 긴 인용문은 작은 창 안에서 줄을 바꾸며 내용을 읽을 수 있어야 합니다. 여러 문장을 이어 붙여 인용 안쪽의 글이 창 오른쪽을 밀지 않는지 확인합니다.

1. 첫 번째 단계에는 여러 설명이 포함되어 좁은 폭에서 문장이 여러 줄로 표시됩니다.
   1. 두 번째 단계에도 충분히 긴 설명을 두어 실제 들여쓰기 목록의 모양을 확인합니다.
      1. 세 번째 단계의 설명도 길게 이어져 읽을 때 계층과 들여쓰기가 유지되는지 봅니다.

| 항목 | 긴 주소 | 설명 | 상태 | 용도 | 메모 |
| --- | --- | --- | --- | --- | --- |
| 하나 | https://example.com/table/one/two/three/four/five/six/seven/eight/nine/ten | 표 안에서도 긴 한글 설명은 폭 안에서 줄을 바꿉니다 | 대기 | 브라우저 | 첫 항목 |

```text
    1. 첫 번째 들여쓰기 목록 항목은 좁은 창 안에서 여러 줄로 이어지며 뒷줄도 현재 줄의 들여쓰기에서 시작해야 합니다.
        1. 두 번째 단계도 매우 긴 한글 설명을 포함하여 실제 캡처에서 보인 계층 모양을 재현합니다.
            1. 세 번째 단계는 가장 깊은 들여쓰기와 줄바꿈 위치를 확인하는 데 쓰입니다.

    실행 명령: kaleidoscope --workspace /very/long/path/that/contains/a/large/number/of/arguments/and/should/wrap/without/horizontal/scrolling
		탭으로 들여쓴 줄도 창 안에서 자연스럽게 줄을 바꿉니다.
```

`inline-code-with-a-very-long-unbroken-value-that-must-wrap-at-the-window-boundary`
