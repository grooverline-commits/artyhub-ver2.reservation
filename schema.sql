-- ============================================================================
-- ARTYHUB 長野 ワークショップ体験予約システム (Ver2)
-- Supabase (PostgreSQL) データベース初期化・マイグレーションSQL
--
-- 使い方:
-- Supabase ダッシュボード > SQL Editor > New query に貼り付けて「Run」を実行してください。
-- ============================================================================

-- UUID生成用拡張（Supabaseでは標準有効ですが念のため）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. contents（商材・コンテンツマスタ）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  max_people_per_group INTEGER NOT NULL DEFAULT 4 CHECK (max_people_per_group >= 1),
  description TEXT NOT NULL DEFAULT '',
  -- 例: [{"time":"10:00","max_groups":2},{"time":"13:00","max_groups":2}]
  default_time_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.contents IS 'ワークショップ商材・コンテンツマスタ';
COMMENT ON COLUMN public.contents.default_time_slots IS '7時間帯候補のうち有効な時間と最大組数のJSON配列';

CREATE INDEX IF NOT EXISTS idx_contents_active_sort
  ON public.contents (is_active, sort_order, created_at);

-- ----------------------------------------------------------------------------
-- 2. daily_schedules（日別の予約枠上書き設定）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
  target_date DATE NOT NULL,
  -- 空配列 [] ならその日は受付停止
  custom_time_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_schedules_content_date UNIQUE (content_id, target_date)
);

COMMENT ON TABLE public.daily_schedules IS '商材ごとの日別予約枠上書き設定（空配列は受付停止）';

CREATE INDEX IF NOT EXISTS idx_daily_schedules_content_date
  ON public.daily_schedules (content_id, target_date);

-- ----------------------------------------------------------------------------
-- 3. reservations（予約データ）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES public.contents(id) ON DELETE SET NULL,
  content_title TEXT NOT NULL DEFAULT '',
  reservation_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  people_count INTEGER NOT NULL CHECK (people_count >= 1),
  total_price INTEGER NOT NULL DEFAULT 0 CHECK (total_price >= 0),
  status TEXT NOT NULL DEFAULT '未対応'
    CHECK (status IN ('未対応', '確定', '来店済', 'キャンセル')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.reservations IS 'お客様からのワークショップ予約データ';

CREATE INDEX IF NOT EXISTS idx_reservations_date
  ON public.reservations (reservation_date);

CREATE INDEX IF NOT EXISTS idx_reservations_availability
  ON public.reservations (content_id, reservation_date, time_slot, status);

CREATE INDEX IF NOT EXISTS idx_reservations_status
  ON public.reservations (status);

-- ----------------------------------------------------------------------------
-- 4. external_links（SNS・外部リンク集）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.external_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.external_links IS 'Instagram・TikTok・HP・Googleマップ等の外部リンク集';

CREATE INDEX IF NOT EXISTS idx_external_links_sort
  ON public.external_links (sort_order, created_at);

-- ----------------------------------------------------------------------------
-- updated_at 自動更新トリガー
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contents_updated_at ON public.contents;
CREATE TRIGGER trg_contents_updated_at
  BEFORE UPDATE ON public.contents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_daily_schedules_updated_at ON public.daily_schedules;
CREATE TRIGGER trg_daily_schedules_updated_at
  BEFORE UPDATE ON public.daily_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_reservations_updated_at ON public.reservations;
CREATE TRIGGER trg_reservations_updated_at
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_external_links_updated_at ON public.external_links;
CREATE TRIGGER trg_external_links_updated_at
  BEFORE UPDATE ON public.external_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security (RLS) 設定
-- ※ Render上のExpressサーバーから service_role キーで接続する場合はRLSをバイパスします。
--   anonキーで運用する場合もAPIサーバー経由で動作するようポリシーを定義しています。
-- ----------------------------------------------------------------------------
ALTER TABLE public.contents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_links DISABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Supabase Storage バケット作成（商材写真アップロード用）
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'content-images',
  'content-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage の公開読み取り・アップロード許可ポリシー
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public read content-images'
  ) THEN
    CREATE POLICY "Public read content-images"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'content-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow upload content-images'
  ) THEN
    CREATE POLICY "Allow upload content-images"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'content-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow update content-images'
  ) THEN
    CREATE POLICY "Allow update content-images"
      ON storage.objects FOR UPDATE
      USING (bucket_id = 'content-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow delete content-images'
  ) THEN
    CREATE POLICY "Allow delete content-images"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'content-images');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- （任意）テスト用サンプルデータ投入例
-- 必要な場合は以下のコメントアウトを外して実行してください
-- ----------------------------------------------------------------------------
/*
INSERT INTO public.contents (title, image_url, price, max_people_per_group, description, default_time_slots, is_active, sort_order)
VALUES
  (
    'フルイドアート（たらし込みアート）体験',
    '',
    3800,
    4,
    '絵の具をキャンバスに流して世界に一つだけの抽象画を作る人気No.1ワークショップです。初めての方でも講師が丁寧にサポートします。',
    '[{"time":"10:00","max_groups":2},{"time":"11:30","max_groups":2},{"time":"13:00","max_groups":2},{"time":"14:30","max_groups":2},{"time":"16:00","max_groups":2}]'::jsonb,
    true,
    1
  ),
  (
    'テクスチャーアート体験',
    '',
    4500,
    4,
    'ペーストとアクリル絵の具を使い、立体感のあるおしゃれなアートパネルを制作します。インテリアに馴染む色合いで仕上げられます。',
    '[{"time":"10:00","max_groups":2},{"time":"13:00","max_groups":2},{"time":"16:00","max_groups":2},{"time":"17:30","max_groups":1}]'::jsonb,
    true,
    2
  );

INSERT INTO public.external_links (title, url, description, sort_order)
VALUES
  ('Instagram', 'https://www.instagram.com/', '最新の作品事例やワークショップの様子を毎日発信中！', 1),
  ('TikTok', 'https://www.tiktok.com/', '制作風景のショート動画やアートのコツをお届けしています。', 2),
  ('Googleマップ（アクセス）', 'https://maps.google.com/', 'ARTYHUB 長野店へのアクセス・道順はこちらからご確認いただけます。', 3);
*/
