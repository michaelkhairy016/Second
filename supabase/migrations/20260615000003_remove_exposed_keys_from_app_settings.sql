-- Remove compromised Resend API key and service_role placeholder from app_settings.
-- send-report edge function now reads RESEND_API_KEY from an edge-function secret instead.
UPDATE public.app_settings
SET value = (value - 'resend_api_key' - 'service_role_key')
WHERE key = 'report_emails';
