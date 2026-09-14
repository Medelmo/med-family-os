import type { Sensitivity, Visibility } from "../shared/types";

export interface Person {
  id: string;
  householdId: string;
  accountUserId: string | null;
  displayName: string;
  dateOfBirth: Date | null;
  visibility: Visibility;
  sensitivity: Sensitivity;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  version: number;
}
