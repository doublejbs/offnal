export enum RateLimitScope {
  UPLOAD_ANONYMOUS = 'upload:anon',
  UPLOAD_IP = 'upload:ip',
  UPLOAD_USER = 'upload:user',
  EXTRACT_USER = 'extract:user',
  SHARED_VIEW_IP = 'shared:ip',
  PAYMENT_WEBHOOK_IP = 'webhook:ip',
}
