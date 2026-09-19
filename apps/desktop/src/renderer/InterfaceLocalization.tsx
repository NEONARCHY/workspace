import { useEffect } from "react";
import { getInterfaceLocale, locales, translateText, type Locale } from "@yuksalish/i18n";

const sourceText = new WeakMap<Text, string>();
const sourceAttributes = new WeakMap<Element, Map<string, string>>();
const attributes = ["aria-label", "aria-description", "placeholder", "title", "alt"] as const;
const isKnownRendering = (source: string, current: string) => locales.some((candidate) => translateText(source, candidate) === current);

function localizeTextNode(node: Text, locale: Locale): void {
  const current = node.nodeValue ?? "";
  const remembered = sourceText.get(node);
  if (remembered === undefined || !isKnownRendering(remembered, current)) {
    sourceText.set(node, current);
  }
  const source = sourceText.get(node) ?? current;
  const translated = translateText(source, locale);
  if (translated !== current) node.nodeValue = translated;
}

function localizeElement(element: Element, locale: Locale): void {
  let remembered = sourceAttributes.get(element);
  if (!remembered) { remembered = new Map(); sourceAttributes.set(element, remembered); }
  for (const attribute of attributes) {
    const current = element.getAttribute(attribute);
    if (current === null) continue;
    const source = remembered.get(attribute);
    if (source === undefined || !isKnownRendering(source, current)) remembered.set(attribute, current);
    const translated = translateText(remembered.get(attribute) ?? current, locale);
    if (translated !== current) element.setAttribute(attribute, translated);
  }
}

function localizeTree(root: Node, locale: Locale): void {
  if (root instanceof Text) localizeTextNode(root, locale);
  if (root instanceof Element) localizeElement(root, locale);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  let node = walker.nextNode();
  while (node) {
    if (node instanceof Text) localizeTextNode(node, locale);
    else if (node instanceof Element) localizeElement(node, locale);
    node = walker.nextNode();
  }
}

export function InterfaceLocalization() {
  useEffect(() => {
    let locale = getInterfaceLocale();
    let applying = false;
    const apply = (root: Node = document.body) => {
      applying = true;
      localizeTree(root, locale);
      applying = false;
    };
    apply();
    const observer = new MutationObserver((mutations) => {
      if (applying) return;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") apply(mutation.target);
        else if (mutation.type === "attributes") apply(mutation.target);
        else for (const node of mutation.addedNodes) apply(node);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...attributes] });
    const onLocale = (event: Event) => { locale = (event as CustomEvent<Locale>).detail; apply(); };
    window.addEventListener("yuksalish:locale", onLocale);
    return () => { observer.disconnect(); window.removeEventListener("yuksalish:locale", onLocale); };
  }, []);
  return null;
}
