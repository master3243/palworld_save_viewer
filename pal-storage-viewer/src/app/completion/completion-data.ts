import type { CompletionData } from './completion-model';

let dataPromise: Promise<CompletionData> | undefined;

/** Share the tracker catalog between the tracker and source-file tooltips. */
export function loadCompletionData(): Promise<CompletionData> {
  dataPromise ??= (async () => {
    const response = await fetch(new URL('resources/completion/completion-data.json', document.baseURI));
    if (!response.ok) throw new Error(`Could not load the completion data (${response.status}).`);
    return await response.json() as CompletionData;
  })().catch(error => {
    dataPromise = undefined;
    throw error;
  });
  return dataPromise;
}
