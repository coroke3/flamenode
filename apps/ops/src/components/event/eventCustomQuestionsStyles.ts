/** MIG-0721: CURRENT CSS-module styles scoped as stable names for Node SSR and Ops Vite. */
export const editorStyles = {
  "questionList": "opsEventQuestionList",
  "questionCard": "opsEventQuestionCard",
  "questionHeader": "opsEventQuestionHeader",
  "questionControls": "opsEventQuestionControls",
  "typePicker": "opsEventTypePicker",
  "typeButton": "opsEventTypeButton",
  "optionsEditor": "opsEventOptionsEditor",
  "optionRow": "opsEventOptionRow",
  "optionRowControls": "opsEventOptionRowControls",
  "preview": "opsEventPreview"
} as const;
export const fieldStyles = {
  "customChoiceGroup": "opsEventCustomChoiceGroup",
  "customChoiceOption": "opsEventCustomChoiceOption"
} as const;
export const editorCss = ".opsEventQuestionList {\n  display: grid;\n  gap: 10px;\n}\n\n.opsEventQuestionCard {\n  padding: 12px;\n  display: grid;\n  gap: 10px;\n}\n\n.opsEventQuestionHeader {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n\n.opsEventQuestionControls {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n  flex-wrap: wrap;\n}\n\n.opsEventTypePicker {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.opsEventTypeButton[aria-pressed=\"true\"] {\n  border-color: var(--accent-primary);\n  color: var(--text-primary);\n  background: color-mix(in srgb, var(--accent-primary) 10%, var(--bg-surface));\n}\n\n.opsEventOptionsEditor {\n  display: grid;\n  gap: 8px;\n}\n\n.opsEventOptionRow {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;\n  gap: 8px;\n  align-items: center;\n}\n\n.opsEventOptionRowControls {\n  display: flex;\n  gap: 6px;\n  flex-wrap: wrap;\n  align-items: center;\n}\n\n.opsEventPreview {\n  display: grid;\n  gap: 8px;\n  padding: 10px;\n  border: 1px dashed var(--border-subtle);\n  border-radius: var(--radius-sm);\n  background: var(--bg-elevated);\n}\n\n.opsEventQuestionCard (textarea.fn-input) {\n  min-height: 72px;\n}\n\n@media (max-width: 640px) {\n  .opsEventOptionRow {\n    grid-template-columns: minmax(0, 1fr);\n  }\n\n  .opsEventOptionRow (.fn-btn),\n  .opsEventOptionRowControls (.fn-btn),\n  .opsEventQuestionControls (.fn-btn) {\n    min-height: var(--fn-control-h-touch);\n    justify-content: center;\n  }\n}\n";
export const fieldCss = ".opsEventCustomChoiceGroup {\n  display: grid;\n  gap: 8px;\n  margin: 0;\n  padding: 0;\n  border: 0;\n  min-width: 0;\n  min-inline-size: 0;\n}\n\n.opsEventCustomChoiceOption {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-height: var(--fn-control-h);\n  padding: 8px 12px;\n  border: 1px solid var(--border-subtle);\n  border-radius: var(--radius-sm);\n  background: var(--bg-elevated);\n  cursor: pointer;\n}\n\n.opsEventCustomChoiceOption:has(input:checked) {\n  border-color: var(--accent-primary);\n  background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-surface));\n}\n\n.opsEventCustomChoiceOption:has(input:focus-visible) {\n  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-primary) 18%, transparent);\n}\n\n.opsEventCustomChoiceOption input {\n  margin: 0;\n  flex: 0 0 auto;\n}\n\n@media (hover: none) and (pointer: coarse) {\n  .opsEventCustomChoiceOption {\n    min-height: var(--fn-control-h-touch);\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .opsEventCustomChoiceOption {\n    transition: none;\n  }\n}\n";
