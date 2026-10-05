import { workspacePlatform } from "./platform-adapter";

const configuredPublicOrigin = import.meta.env.VITE_API_BASE_URL;
const configuredLanOrigin = import.meta.env.VITE_LAN_API_BASE_URL;
const configuredDeploymentId = import.meta.env.VITE_DEPLOYMENT_ID;
const listeners = new Set<(origin: string) => void>();
let activeOrigin: string | undefined;
let initialSelection: Promise<string> | undefined;
let failoverSelection: Promise<string> | undefined;

function exactHttpsOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.username || parsed.password) {
    throw new Error("Адрес рабочего сервера должен быть точным HTTPS origin без пути.");
  }
  return value;
}

function dualOrigins(): { lan: string; public: string; deploymentId: string } | undefined {
  if (workspacePlatform.kind !== "electron") return undefined;
  if (!configuredLanOrigin && !configuredDeploymentId) return undefined;
  if (!configuredPublicOrigin || !configuredLanOrigin || !configuredDeploymentId) {
    throw new Error("Установщик не содержит полную конфигурацию офисного и удалённого адресов.");
  }
  return {
    lan: exactHttpsOrigin(configuredLanOrigin),
    public: exactHttpsOrigin(configuredPublicOrigin),
    deploymentId: configuredDeploymentId.toLowerCase(),
  };
}

async function probe(origin: string, deploymentId: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${origin}/api/v1/health/ready`, {
      cache: "no-store", credentials: "omit", signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null
      && "status" in body && body.status === "ready"
      && "service" in body && body.service === "yuksalish-api"
      && "deployment_id" in body && body.deployment_id === deploymentId;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

function setActiveOrigin(origin: string): void {
  if (activeOrigin === origin) return;
  activeOrigin = origin;
  listeners.forEach((listener) => listener(origin));
}

export function supportsDualApiOrigins(): boolean {
  return workspacePlatform.kind === "electron" && Boolean(configuredLanOrigin || configuredDeploymentId);
}

export function getApiBaseUrl(): string {
  if (workspacePlatform.kind === "web") return window.location.origin;
  if (supportsDualApiOrigins()) {
    if (!activeOrigin) throw new Error("Соединение с рабочим сервером ещё не подтверждено.");
    return activeOrigin;
  }
  return configuredPublicOrigin ?? "http://127.0.0.1:8080";
}

export function isRemoteApiOrigin(): boolean {
  const origins = dualOrigins();
  return !!origins && getApiBaseUrl() === origins.public;
}

export function apiConnectionLabel(): string {
  const origins = dualOrigins();
  if (!origins || !activeOrigin) return "Сервер подключён";
  return activeOrigin === origins.lan ? "Офисный сервер · LAN" : "Офисный сервер · удалённо";
}

export function subscribeToApiOrigin(listener: (origin: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initializeApiOrigin(): Promise<string> {
  const origins = dualOrigins();
  if (!origins) return Promise.resolve(getApiBaseUrl());
  if (activeOrigin) return Promise.resolve(activeOrigin);
  if (!initialSelection) {
    initialSelection = (async () => {
      for (const origin of [origins.lan, origins.public]) {
        if (await probe(origin, origins.deploymentId)) {
          setActiveOrigin(origin);
          return origin;
        }
      }
      throw new Error("Офисный и удалённый серверы недоступны или не совпадают с этим Workspace.");
    })().finally(() => { initialSelection = undefined; });
  }
  return initialSelection;
}

export async function switchApiOrigin(): Promise<string> {
  const origins = dualOrigins();
  if (!origins) throw new Error("В этом клиенте настроен только один адрес сервера.");
  const candidate = getApiBaseUrl() === origins.lan ? origins.public : origins.lan;
  if (!await probe(candidate, origins.deploymentId)) {
    throw new Error("Другой адрес недоступен или относится к другому развёртыванию Workspace.");
  }
  setActiveOrigin(candidate);
  return candidate;
}

export async function failoverApiOrigin(failedOrigin: string): Promise<string | undefined> {
  const origins = dualOrigins();
  if (!origins) return undefined;
  if (failedOrigin !== origins.lan && failedOrigin !== origins.public) return undefined;
  if (activeOrigin !== failedOrigin) return activeOrigin;
  if (!failoverSelection) {
    failoverSelection = (async () => {
      const candidate = failedOrigin === origins.lan ? origins.public : origins.lan;
      if (!await probe(candidate, origins.deploymentId)) {
        throw new Error("Другой адрес этого Workspace сейчас недоступен.");
      }
      setActiveOrigin(candidate);
      return candidate;
    })().finally(() => { failoverSelection = undefined; });
  }
  return failoverSelection;
}
