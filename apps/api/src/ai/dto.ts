import { z } from "zod";

export const CreateConversationSchema = z
  .object({ title: z.string().min(1).max(200).optional() })
  .strict();

export const AskSchema = z.object({ message: z.string().min(1).max(2000) }).strict();
