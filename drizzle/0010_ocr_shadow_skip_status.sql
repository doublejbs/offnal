-- OCR 그림자 실행(docs/Spec.md §22-9): 건너뜀 상태(skipped_busy·skipped_budget) 추가, error_name을 고정 분류로 제한.
-- 기존 행의 error_name(오류 클래스 이름)은 분류할 수 없으므로 'unknown'으로 바꾼 뒤 제약을 건다.
UPDATE "ocr_shadow_runs" SET "error_name" = 'unknown' WHERE "error_name" IS NOT NULL AND "error_name" NOT IN ('download', 'worker_init', 'recognize', 'decode', 'table', 'unknown');--> statement-breakpoint
ALTER TABLE "ocr_shadow_runs" DROP CONSTRAINT "ocr_shadow_runs_status_check";--> statement-breakpoint
ALTER TABLE "ocr_shadow_runs" ADD CONSTRAINT "ocr_shadow_runs_error_name_check" CHECK ("ocr_shadow_runs"."error_name" in ('download', 'worker_init', 'recognize', 'decode', 'table', 'unknown'));--> statement-breakpoint
ALTER TABLE "ocr_shadow_runs" ADD CONSTRAINT "ocr_shadow_runs_status_check" CHECK ("ocr_shadow_runs"."status" in ('ok', 'table_failed', 'row_not_found', 'timeout', 'error', 'skipped_busy', 'skipped_budget'));
