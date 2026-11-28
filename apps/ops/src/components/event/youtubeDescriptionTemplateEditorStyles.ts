// MIG-0721: CURRENT CSS-module declarations with isolated stable class names for the Ops editor.
export const youtubeTemplateEditorStyles = {
  "root": "opsYoutubeTemplateRoot",
  "header": "opsYoutubeTemplateHeader",
  "description": "opsYoutubeTemplateDescription",
  "presetBar": "opsYoutubeTemplatePresetBar",
  "presetLabel": "opsYoutubeTemplatePresetLabel",
  "workspace": "opsYoutubeTemplateWorkspace",
  "editorColumn": "opsYoutubeTemplateEditorColumn",
  "textarea": "opsYoutubeTemplateTextarea",
  "textareaMeta": "opsYoutubeTemplateTextareaMeta",
  "actions": "opsYoutubeTemplateActions",
  "variableGroups": "opsYoutubeTemplateVariableGroups",
  "variableGroup": "opsYoutubeTemplateVariableGroup",
  "variableGroupTitle": "opsYoutubeTemplateVariableGroupTitle",
  "variableButtons": "opsYoutubeTemplateVariableButtons",
  "variableButton": "opsYoutubeTemplateVariableButton",
  "variableToken": "opsYoutubeTemplateVariableToken",
  "helpCard": "opsYoutubeTemplateHelpCard",
  "previewColumn": "opsYoutubeTemplatePreviewColumn",
  "previewCard": "opsYoutubeTemplatePreviewCard",
  "previewHead": "opsYoutubeTemplatePreviewHead",
  "previewText": "opsYoutubeTemplatePreviewText"
} as const;

export const youtubeTemplateEditorCss = `.opsYoutubeTemplateRoot {
  display: grid;
  gap: 14px;
}

.opsYoutubeTemplateHeader {
  display: grid;
  gap: 6px;
}

.opsYoutubeTemplateDescription {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.65;
}

.opsYoutubeTemplatePresetBar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.opsYoutubeTemplatePresetLabel {
  margin-right: 2px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.opsYoutubeTemplateWorkspace {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(300px, 0.75fr);
  gap: 16px;
  align-items: start;
}

.opsYoutubeTemplateEditorColumn {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.opsYoutubeTemplatePreviewColumn {
  position: sticky;
  top: calc(var(--header-h, 64px) + 16px);
  display: grid;
  gap: 10px;
  min-width: 0;
}

.opsYoutubeTemplateTextarea {
  min-height: 280px;
  resize: vertical;
  font-family: var(--font-mono);
  line-height: 1.65;
}

.opsYoutubeTemplateTextareaMeta {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  margin-top: 6px;
}

.opsYoutubeTemplateActions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.opsYoutubeTemplateVariableGroups {
  display: grid;
  gap: 12px;
}

.opsYoutubeTemplateVariableGroup {
  display: grid;
  gap: 6px;
}

.opsYoutubeTemplateVariableGroupTitle {
  font-size: 12px;
}

.opsYoutubeTemplateVariableButtons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.opsYoutubeTemplateVariableButton {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.opsYoutubeTemplateVariableToken {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
}

.opsYoutubeTemplateHelpCard,
.opsYoutubeTemplatePreviewCard {
  padding: 12px;
  display: grid;
  gap: 8px;
}

.opsYoutubeTemplateHelpCard p,
.opsYoutubeTemplateHelpCard ul,
.opsYoutubeTemplatePreviewCard p {
  margin: 0;
}

.opsYoutubeTemplatePreviewText {
  margin: 0;
  max-height: min(58vh, 560px);
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  line-height: 1.7;
}

.opsYoutubeTemplatePreviewHead {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 980px) {
  .opsYoutubeTemplateWorkspace {
    grid-template-columns: 1fr;
  }

  .opsYoutubeTemplatePreviewColumn {
    position: static;
  }
}

@media (max-width: 640px) {
  .opsYoutubeTemplateTextarea {
    min-height: 220px;
  }

  .opsYoutubeTemplatePresetBar,
  .opsYoutubeTemplateActions {
    align-items: stretch;
  }

  .opsYoutubeTemplatePresetBar > button,
  .opsYoutubeTemplateActions > button {
    flex: 1 1 140px;
    justify-content: center;
  }
}
`;
