# Contributing Guide

## Clone และรัน Local

### Prerequisites

- Node.js 20+ และ npm
- บัญชี [Supabase](https://supabase.com/) (free tier พอ)
- Git

### ขั้นตอน

```bash
# 1. Clone repo
git clone https://github.com/<your-org>/audit-tool.git
cd audit-tool

# 2. ติดตั้ง dependencies
npm install

# 3. ตั้งค่า environment variables
cp .env.example .env.local
# แก้ไข .env.local ใส่ค่าจาก Supabase project ของคุณ

# 4. สร้าง Database (ทำครั้งเดียว)
# ไปที่ Supabase Dashboard → SQL Editor
# รัน supabase/auth-schema.sql ก่อน จากนั้น supabase/app-schema.sql

# 5. รัน dev server
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000) — ควรจะเห็นหน้า login

### สร้าง Admin User สำหรับ Dev

1. Supabase Dashboard → **Authentication → Users → Add user → Create new user**
2. ใส่ email + password ชั่วคราว
3. ไปที่ **Table Editor → profiles** → เปลี่ยน `role` ของ user นั้นเป็น `admin`
4. Login ด้วย email + password ที่สร้าง

---

## Coding Conventions

### ภาษาและ Formatting

- **TypeScript** เสมอ — ไม่ใช้ `any` โดยไม่มีเหตุผล; ใช้ `unknown` แทนแล้ว narrow type
- **Tailwind CSS** สำหรับ styling — ไม่เขียน CSS file แยก
- ไม่ต้องใช้ Prettier หรือ ESLint config พิเศษ — Next.js ESLint จัดการให้

### File Naming

- Pages: `app/<route>/page.tsx` (lowercase kebab-case)
- Components: `components/MyComponent.tsx` (PascalCase)
- Utilities: `lib/myUtil.ts` (camelCase)

### Component Pattern

ทุก client component ต้องมี `'use client'` directive บรรทัดแรก:

```typescript
'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function MyPage() {
  const { canEditChecklist } = useAuth();
  // ...
}
```

### Data Fetching Pattern

ใช้ functions ใน `lib/store.ts` เท่านั้น — ไม่เรียก `supabase` ตรงๆ จาก component:

```typescript
// ✅ ถูก
import { getChecklistItems } from '@/lib/store';
const items = await getChecklistItems();

// ❌ ผิด — เรียก supabase ตรงๆ จาก component
import { supabase } from '@/lib/supabase';
const { data } = await supabase.from('checklist_items').select('*');
```

ยกเว้น: Server Actions ใน `app/**/actions.ts` ที่ต้องการ server-side client (`createSupabaseServer()`)

### Store Pattern (lib/store.ts)

ทุก query ต้องผ่าน `withTimeout()` และ error ต้องผ่าน `pgErr()`:

```typescript
export async function getMyItems(): Promise<MyType[]> {
  const { data, error } = await withTimeout(
    supabase.from('my_table').select('id, data'),
  );
  if (error) throw pgErr(error);
  return (data ?? []).map(r => fromRow<MyType>(r as DataRow));
}
```

### Auth & Role Guards

ใน component ใช้ `useAuth()`:

```typescript
const { isAdmin, canEditChecklist, canEditDashboard } = useAuth();
if (!isAdmin) return null; // หรือ redirect
```

ใน Server Action ใช้ `assertAdmin()` pattern (ดูตัวอย่างใน `app/settings/users/actions.ts`)

### Error Handling

- ใช้ `try/catch` ใน event handlers และ `useEffect`
- แสดง error ด้วย state (`const [error, setError] = useState<string | null>(null)`)
- ไม่ใช้ `alert()` ยกเว้น confirm dialog ที่จำเป็น

### ไม่ต้องทำ

- ไม่ต้องเขียน test (โปรเจกต์นี้ไม่มี test suite)
- ไม่ต้องเขียน JSDoc ทุก function — เขียนเฉพาะ function ที่ logic ซับซ้อน

---

## วิธี Submit การแก้ไข

### Flow สำหรับทีมเล็ก (direct push)

```bash
# 1. ดึง code ล่าสุด
git pull origin main

# 2. แก้ไข code

# 3. Build เพื่อเช็คว่าไม่มี error
npm run build

# 4. Commit พร้อม message ที่อธิบายชัดเจน
git add <files>
git commit -m "fix(checklist): แก้ bug การ sort session ผิดลำดับ"

# 5. Push
git push origin main
```

### Commit Message Format

ใช้รูปแบบ `<type>(<scope>): <description>`:

| Type | ใช้เมื่อ |
|------|---------|
| `feat` | เพิ่ม feature ใหม่ |
| `fix` | แก้ bug |
| `refactor` | ปรับ code โดยไม่เปลี่ยน behavior |
| `chore` | งานอื่นๆ เช่น update dependency, config |
| `docs` | แก้ไข documentation เท่านั้น |

ตัวอย่าง:
```
feat(dashboard): add corrective action filter by status
fix(auth): prevent redirect loop on set-password page
refactor(store): extract withTimeout helper
docs: update README with deploy steps
```

### ก่อน Push ทุกครั้ง

```bash
npm run build   # ต้องผ่าน — ไม่มี TypeScript error, ไม่มี missing import
npm run lint    # ควรผ่าน
```

### Environment Variables

- **ห้าม** commit `.env.local` ขึ้น git (มีอยู่ใน `.gitignore` แล้ว)
- ถ้าเพิ่ม env var ใหม่ ต้องอัปเดต `.env.example` ด้วย (ไม่ใส่ค่าจริง)
- ต้องตั้งค่าใน Vercel Dashboard ด้วย ถ้าใช้ในฝั่ง production

### Database Schema Changes

ถ้าต้องเปลี่ยน schema:

1. เขียน SQL สำหรับ migration
2. รันใน Supabase SQL Editor ของ production project
3. อัปเดต `supabase/app-schema.sql` ให้ตรงกับ production
4. อัปเดต types ใน `lib/types.ts` ถ้ามี field ใหม่

> ตาราง `{ id, data: JSONB }` — ถ้าแค่เพิ่ม field ใน data object ไม่ต้อง migrate database เลย แค่อัปเดต TypeScript interface
