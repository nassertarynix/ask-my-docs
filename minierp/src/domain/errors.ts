/**
 * Every rule violation is a DomainError with a stable machine-readable `code`.
 * The UI translates the code (English / Arabic), so no sentence is hard-coded in the domain layer.
 */
export type ErrorCode =
  | 'invalid_name'
  | 'invalid_sku'
  | 'duplicate_sku'
  | 'invalid_amount'
  | 'invalid_quantity'
  | 'invalid_date'
  | 'not_found'
  | 'no_lines'
  | 'wrong_status'
  | 'insufficient_stock'
  | 'overpayment'
  | 'has_payments'
  | 'already_invoiced'
  | 'in_use'
  | 'negative_stock'
  | 'invalid_file';

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly params: Record<string, string | number>;

  constructor(code: ErrorCode, params: Record<string, string | number> = {}, message?: string) {
    super(message ?? `${code} ${JSON.stringify(params)}`);
    this.name = 'DomainError';
    this.code = code;
    this.params = params;
  }
}
