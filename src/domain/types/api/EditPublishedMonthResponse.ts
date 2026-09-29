/** POST /api/calendar/:yearMonth/edit. Returns the existing editing draft for the month when there is one. */
export type EditPublishedMonthResponse = {
  draftId: string;
};
