import * as vscode from 'vscode';
import type { EditorContext } from './api';

/** Selections above this are truncated rather than refused. */
const MAX_SELECTION_CHARS = 8_000;

/**
 * Collects what the assistant needs to answer about the code in front of the
 * developer.
 *
 * Reading only. The selection is sent to answer the question and is never
 * stored; the intent classifier that drives ad targeting does not receive it at
 * all. Whether code was attached is a useful signal, the code itself is not.
 */
export function collectEditorContext(includeSelection: boolean): EditorContext | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;

  const context: EditorContext = {
    languageId: editor.document.languageId,
    fileName: vscode.workspace.asRelativePath(editor.document.uri),
    workspaceName: vscode.workspace.workspaceFolders?.[0]?.name,
  };

  if (includeSelection && !editor.selection.isEmpty) {
    context.selection = editor.document.getText(editor.selection).slice(0, MAX_SELECTION_CHARS);
  }

  return context;
}

export function hasSelection(): boolean {
  const editor = vscode.window.activeTextEditor;
  return editor !== undefined && !editor.selection.isEmpty;
}
