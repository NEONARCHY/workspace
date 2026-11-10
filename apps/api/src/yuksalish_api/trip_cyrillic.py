"""Uzbek script conversion, without translating or replacing Cyrillic employee prose."""

import re

_LETTERS = dict(zip(
    "abdefghijklmnopqrstuvxyz",
    "абдефгҳижклмнопқрстувхйз", strict=True,
))
_PAIRS = {"o'": "ў", "g'": "ғ", "sh": "ш", "ch": "ч", "yo": "ё",
          "yu": "ю", "ya": "я", "ye": "\u0435", "ts": "ц"}


def uzbek_cyrillic(value: str) -> str:
    def convert(match: re.Match[str]) -> str:
        word = match[0]
        normalized = re.sub("[\u02bb\u02bc\u2018\u2019]", "'", word).lower()
        result = []
        index = 0
        while index < len(normalized):
            pair = normalized[index:index + 2]
            if pair in _PAIRS:
                result.append(_PAIRS[pair])
                index += 2
            else:
                letter = normalized[index]
                result.append("ъ" if letter == "'" else "э" if letter == "e" and index == 0
                              else _LETTERS.get(letter, letter))
                index += 1
        text = "".join(result)
        if word.isupper():
            return text.upper()
        return text[:1].upper() + text[1:] if word[0].isupper() else text

    return re.sub("[A-Za-z]+(?:['\u02bb\u02bc\u2018\u2019][A-Za-z]+)*", convert, value)
