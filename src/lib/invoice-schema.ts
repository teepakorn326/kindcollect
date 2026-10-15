// Create Invoice form schema — shared by the client form (react-hook-form) and the server action.
import { z } from "zod";
import { parseAmountToCents } from "./money";

const amount = z
  .string()
  .trim()
  .refine((v) => parseAmountToCents(v) !== null, "Enter an amount like 47.00");

export const invoiceLineSchema = z.object({
  description: z.string().trim().min(1, "Describe the item"),
  quantity: z.coerce.number().int("Whole boxes only").positive("At least 1"),
  unitPrice: amount,
  /** "Keep 24 and explain" — a note that downgrades a three-way mismatch to a warning */
  note: z.string().trim().max(200).optional().default(""),
});

export const invoiceFormSchema = z.object({
  customerId: z.string().min(1, "Choose a customer"),
  number: z.string().trim().regex(/^INV-\d{4,}$/, "Format INV-1234"),
  poNumber: z.string().trim().max(40).optional().default(""),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(invoiceLineSchema).min(1, "Add at least one line"),
  paymentInstructions: z.string().trim().max(500),
});

export type InvoiceFormInput = z.input<typeof invoiceFormSchema>;
export type InvoiceFormValues = z.output<typeof invoiceFormSchema>;
