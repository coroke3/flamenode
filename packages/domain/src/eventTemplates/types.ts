export interface EventTemplateActionResult {
  ok: boolean;
  message?: string;
  templateId?: string;
}

export interface SaveEventTemplateInput {
  event_id: string;
  name: string;
  description?: string | null;
}
