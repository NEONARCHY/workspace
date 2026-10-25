/** Account-owned receipts for release entries, independent of device/build IDs. */
export interface ReleaseReadState {
  readonly readEntryIds: readonly string[];
}

export interface ReleaseReadInput {
  readonly entryIds: readonly string[];
}
