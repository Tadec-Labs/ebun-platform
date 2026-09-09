/**
 * Mirrors the Postgres `notification_channel` enum in
 * supabase/migrations/20260817040312_ebun_initial_schema.sql exactly.
 */
export enum NotificationChannel {
  Whatsapp = 'whatsapp',
  Sms = 'sms',
  Email = 'email',
  Push = 'push',
}
