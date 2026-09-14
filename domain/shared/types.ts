export type Visibility = "PRIVATE" | "HOUSEHOLD" | "SHARED";
export type Sensitivity = "NORMAL" | "SENSITIVE" | "HIGHLY_SENSITIVE";
export type Role = "OWNER" | "ADMIN" | "ADULT" | "CHILD" | "VIEWER";

export type Priority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export interface HouseholdScoped {
  id: string;
  householdId: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  visibility: Visibility;
  sensitivity: Sensitivity;
}
