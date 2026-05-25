export interface StagePermissionFieldSettings {
  enabled: boolean;
  required: boolean;
  label: string;
  description: string;
  placeholder: string;
}

export interface VideoFormSettings {
  stage_permission?: Partial<StagePermissionFieldSettings> | null;
}

export const DEFAULT_STAGE_PERMISSION_FIELD: StagePermissionFieldSettings = {
  enabled: true,
  required: false,
  label: "ステージ・素材・権利まわりの使用許可",
  description:
    "ステージ、モデル、素材、その他権利確認が必要なものについて記入してください。",
  placeholder: "例：自作ステージ / 利用規約確認済み / 権利者許可済み など",
};

function cleanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function parseVideoFormSettings(
  raw: string | null | undefined,
): VideoFormSettings {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as VideoFormSettings;
  } catch {
    return {};
  }
}

export function resolveStagePermissionField(
  settingsList: readonly VideoFormSettings[],
): StagePermissionFieldSettings | null {
  const enabled = settingsList
    .map((settings) => settings.stage_permission)
    .filter(
      (settings): settings is Partial<StagePermissionFieldSettings> =>
        !!settings && settings.enabled === true,
    );

  if (enabled.length === 0) return null;

  const first = enabled[0] ?? {};
  return {
    enabled: true,
    required: enabled.some((settings) => settings.required === true),
    label: cleanText(first.label, DEFAULT_STAGE_PERMISSION_FIELD.label),
    description: cleanText(
      first.description,
      DEFAULT_STAGE_PERMISSION_FIELD.description,
    ),
    placeholder: cleanText(
      first.placeholder,
      DEFAULT_STAGE_PERMISSION_FIELD.placeholder,
    ),
  };
}

export function resolveStagePermissionFieldFromJson(
  rawSettings: readonly (string | null | undefined)[],
): StagePermissionFieldSettings | null {
  return resolveStagePermissionField(rawSettings.map(parseVideoFormSettings));
}
