"use client";

import * as React from "react";
import styles from "./AdminSpreadsheetClient.module.css";
import { SpreadsheetDelimitedTools } from "./SpreadsheetDelimitedTools";
import { SpreadsheetGrid } from "./SpreadsheetGrid";
import { SpreadsheetUndoRedoButtons } from "./SpreadsheetUndoRedoButtons";
import { useAdminSpreadsheet } from "./useAdminSpreadsheet";
import { Icon } from "@/components/ui/Icon";

export function AdminSpreadsheetClient({
  initialTable,
}: {
  initialTable?: string;
}): React.ReactElement {
  const ss = useAdminSpreadsheet(initialTable);

  const shellClass =
    styles.shell + (ss.fullscreen ? ` ${styles.shellFullscreen}` : "");

  return (
    <div ref={ss.shellRef} className={shellClass}>
      <nav className={styles.sidebar} aria-label="テーブル一覧">
        <div className={styles.sidebarHead}>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={() => void ss.loadTableList(true)}
            disabled={ss.tablesLoading}
            title="DB のテーブル一覧を再取得（マイグレーション後）"
          >
            <Icon name="refresh" size={12} aria-hidden />
            {ss.tablesLoading ? "更新中…" : "テーブル更新"}
          </button>
        </div>
        {ss.schemaNotice ? (
          <p className={styles.schemaNotice}>{ss.schemaNotice}</p>
        ) : null}
        {Object.entries(ss.groups).map(([group, items]) => (
          <div key={group}>
            <p className={styles.groupTitle}>{group}</p>
            {items.map((t) => (
              <button
                key={t.table}
                type="button"
                className={
                  styles.tableBtn +
                  (t.table === ss.activeTable ? ` ${styles.tableBtnActive}` : "")
                }
                onClick={() => ss.onSelectTable(t.table)}
              >
                <span>{t.label}</span>
                <span className={styles.modeTag}>
                  {t.mode === "readonly" ? "RO" : "RW"}
                  {t.inSchema === false ? " · DB" : ""}
                </span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.meta}>
            {ss.data ? (
              <>
                <strong>{ss.data.def.label}</strong>
                <span> ({ss.data.def.table})</span>
                <span> · {ss.data.total.toLocaleString()} 行</span>
                <span> · {ss.data.limit} 件/ページ</span>
                <span>
                  {" "}
                  · {ss.data.def.mode === "readonly" ? "読み取り専用" : "編集可"}
                </span>
              </>
            ) : (
              <span>{ss.tables.length} テーブル</span>
            )}
          </div>
          <div className={styles.toolbarActions}>
            {ss.editable ? (
              <button
                type="button"
                className="fn-btn fn-btn-primary fn-btn-sm"
                onClick={() => {
                  if (!ss.data) return;
                  const draft: Record<string, string> = {};
                  for (const col of ss.data.columns) {
                    draft[col.name] = "";
                  }
                  ss.setAddDraft(draft);
                  ss.setAddOpen(true);
                }}
                disabled={!ss.data || ss.data.primaryKeys.length === 0}
                title={
                  ss.data?.primaryKeys.length === 0
                    ? "主キーがないテーブルには行を追加できません"
                    : undefined
                }
              >
                <Icon name="plus" size={12} aria-hidden /> 行を追加
              </button>
            ) : null}
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              onClick={() => void ss.toggleFullscreen()}
              title={ss.fullscreen ? "全画面を終了 (Esc)" : "全画面"}
              aria-pressed={ss.fullscreen}
            >
              <Icon
                name={ss.fullscreen ? "exit-fullscreen" : "fullscreen"}
                size={12}
                aria-hidden
              />
              {ss.fullscreen ? "全画面終了" : "全画面"}
            </button>
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              onClick={() => void ss.loadPage()}
              disabled={ss.loading}
            >
              <Icon name="refresh" size={12} aria-hidden />
              {ss.loading ? "読込中…" : "再読込"}
            </button>
          </div>
        </div>

        {ss.error ? <p className={styles.statusErr}>{ss.error}</p> : null}
        {ss.status ? <p className={styles.status}>{ss.status}</p> : null}

        {ss.data && ss.data.columns.length > 0 ? (
          <SpreadsheetGrid
            columns={ss.data.columns}
            rows={ss.data.rows}
            editable={ss.editable}
            page={ss.data.page}
            limit={ss.data.limit}
            tableName={ss.data.def.table}
            onSaveCell={ss.saveCell}
            onSaveCellsBatch={ss.saveCellsBatch}
            onDeleteRow={ss.deleteRow}
            onAddRowFromTemplate={ss.editable ? ss.openAddRow : undefined}
            onUndo={() => void ss.undo()}
            onRedo={() => void ss.redo()}
            canUndo={ss.canUndo}
            canRedo={ss.canRedo}
            historyBusy={ss.historyBusy}
            toolbar={
              <>
                {ss.editable ? (
                  <SpreadsheetUndoRedoButtons
                    canUndo={ss.canUndo}
                    canRedo={ss.canRedo}
                    undoCount={ss.history.undo.length}
                    redoCount={ss.history.redo.length}
                    busy={ss.historyBusy}
                    onUndo={() => void ss.undo()}
                    onRedo={() => void ss.redo()}
                  />
                ) : null}
                <SpreadsheetDelimitedTools
                  table={ss.data.def.table}
                  tableLabel={ss.data.def.label}
                  columns={ss.data.columns}
                  editable={ss.editable}
                  onImported={() => {
                    ss.resetHistory();
                    void ss.loadPage();
                  }}
                />
              </>
            }
          />
        ) : (
          <p className={styles.status} style={{ padding: 16 }}>
            {ss.loading ? "読み込み中…" : "テーブルを選択してください"}
          </p>
        )}

        {ss.data ? (
          <div className={styles.pager}>
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              disabled={ss.page <= 1 || ss.loading}
              onClick={() => ss.setPage((p) => Math.max(1, p - 1))}
            >
              前へ
            </button>
            <span>
              {ss.page} / {ss.totalPages}
            </span>
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              disabled={ss.page >= ss.totalPages || ss.loading}
              onClick={() => ss.setPage((p) => p + 1)}
            >
              次へ
            </button>
          </div>
        ) : null}
      </div>

      {ss.addOpen && ss.data ? (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="spreadsheet-add-title"
        >
          <div className={styles.modal}>
            <h2 id="spreadsheet-add-title" className={styles.modalTitle}>
              行を追加 — {ss.data.def.label}
            </h2>
            {ss.data.columns
              .filter((col) => col.pk > 0 || col.editable)
              .map((col) => (
                <div key={col.name} className={styles.field}>
                  <label htmlFor={`add-${col.name}`}>
                    {col.name}
                    {col.pk > 0 ? " (PK)" : ""}
                    {col.notNull ? " *" : ""}
                  </label>
                  <input
                    id={`add-${col.name}`}
                    value={ss.addDraft[col.name] ?? ""}
                    onChange={(e) =>
                      ss.setAddDraft((d) => ({
                        ...d,
                        [col.name]: e.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            <div className={styles.modalActions}>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                onClick={() => ss.setAddOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="fn-btn fn-btn-primary fn-btn-sm"
                onClick={() => void ss.insertRow()}
              >
                追加
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
