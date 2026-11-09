// 이름 뒤에 붙는 한국어 조사를 고른다.

export function directionParticle(name: string): string {
  const last = name.codePointAt(name.length - 1);
  if (last === undefined || last < 0xac00 || last > 0xd7a3) return "로";
  const final = (last - 0xac00) % 28;
  return final !== 0 && final !== 8 ? "으로" : "로";
}

// 목적격 조사. 끝의 공백과 문장 부호는 빼고 마지막 글자로 고른다.
export function objectParticle(word: string): "을" | "를" | "을(를)" {
  const stripped = word.replace(/[^0-9A-Za-z가-힣]+$/u, "");
  const last = stripped.codePointAt(stripped.length - 1);
  if (last === undefined) return "을(를)";
  if (last >= 0xac00 && last <= 0xd7a3) return (last - 0xac00) % 28 === 0 ? "를" : "을";
  const char = String.fromCodePoint(last);
  if (char >= "0" && char <= "9") return "013678".includes(char) ? "을" : "를";
  if (/^[A-Za-z]$/.test(char)) return "lmnr".includes(char.toLowerCase()) ? "을" : "를";
  return "을(를)";
}
