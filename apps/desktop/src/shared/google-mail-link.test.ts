import { expect, it } from "vitest";
import { validatedGoogleMailLink } from "./google-mail-link";

function consent() {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: "test-client.apps.googleusercontent.com", response_type: "code",
    redirect_uri: "https://workspace.example.com/api/v1/mail/oauth/callback", state: "s".repeat(40),
    code_challenge: "c".repeat(43), code_challenge_method: "S256",
    scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send" }).toString();
  return url;
}
it("opens only a bounded Google consent flow with the exact mail scopes", () => {
  expect(validatedGoogleMailLink(consent().href)).toBe(consent().href);
  for (const [key,value] of [["redirect_uri", "https://192.168.0.119:8443/api/v1/mail/oauth/callback"],
    ["scope", "https://mail.google.com/"], ["state", "short"], ["code_challenge_method", "plain"], ["client_id", ""]] as const) {
    const url = consent(); url.searchParams.set(key,value);
    expect(validatedGoogleMailLink(url.href)).toBeUndefined();
  }
  const duplicate = consent(); duplicate.searchParams.append("state", "x".repeat(40));
  expect(validatedGoogleMailLink(duplicate.href)).toBeUndefined();
  expect(validatedGoogleMailLink(consent().href.replace("accounts.google.com", "accounts.google.com.evil.example"))).toBeUndefined();
  expect(validatedGoogleMailLink("javascript:alert(1)")).toBeUndefined();
});
it("allows localhost only in the explicitly enabled development mode", () => {
  const url = consent(); url.searchParams.set("redirect_uri", "http://localhost:8000/api/v1/mail/oauth/callback");
  expect(validatedGoogleMailLink(url.href)).toBeUndefined();
  expect(validatedGoogleMailLink(url.href, true)).toBe(url.href);
});
