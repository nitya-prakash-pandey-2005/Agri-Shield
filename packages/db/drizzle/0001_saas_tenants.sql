ALTER TYPE "public"."org_type" ADD VALUE 'insurance';--> statement-breakpoint
ALTER TYPE "public"."org_type" ADD VALUE 'bank';--> statement-breakpoint
ALTER TYPE "public"."org_type" ADD VALUE 'cooperative';--> statement-breakpoint
ALTER TYPE "public"."subscription_plan" ADD VALUE 'business';--> statement-breakpoint
ALTER TYPE "public"."subscription_plan" ADD VALUE 'enterprise';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'enterprise_analyst' BEFORE 'platform_admin';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'enterprise_admin' BEFORE 'platform_admin';