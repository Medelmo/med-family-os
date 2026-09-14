"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { auth } from "../../../infrastructure/auth/auth";
import { addHouseholdMember, type AddHouseholdMemberInput } from "../../../application/commands/household/addHouseholdMember";
import { AuthorizationError } from "../../../application/errors";

export interface AddMemberFormState {
  error?: string;
}

export async function submitAddMember(_prevState: AddMemberFormState, formData: FormData): Promise<AddMemberFormState> {
  const session = await auth();
  if (!session?.user?.householdId || !session.user.role) {
    return { error: "not_authorized" };
  }

  const displayName = String(formData.get("displayName") ?? "");
  const role = String(formData.get("role") ?? "") as AddHouseholdMemberInput["role"];
  const email = String(formData.get("email") ?? "").trim();
  const temporaryPassword = String(formData.get("temporaryPassword") ?? "");

  try {
    await addHouseholdMember(
      {
        userId: session.user.id,
        householdId: session.user.householdId,
        role: session.user.role,
        personIds: session.user.personIds,
      },
      session.user.householdId,
      {
        displayName,
        role,
        account: email ? { email, temporaryPassword } : undefined,
      }
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "not_authorized" };
    }
    if (error instanceof ZodError) {
      return { error: "invalid_input" };
    }
    throw error;
  }

  revalidatePath("/family");
  return {};
}
