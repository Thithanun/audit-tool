# Audit Tool — ISO 27001:2022 & NIST CSF 2.0

เครื่องมือจัดการ Internal Audit สำหรับมาตรฐาน ISO 27001:2022 และ NIST CSF 2.0  
An internal audit management tool for ISO 27001:2022 and NIST CSF 2.0 compliance teams.

---

## ภาษาไทย

### เครื่องมือนี้คืออะไร?

Audit Tool ช่วยให้ทีม Internal Audit จัดการกระบวนการ Audit ได้ครบวงจร ตั้งแต่:

- **วางแผน Audit** (Audit Plan) — กำหนด objective, scope, มาตรฐานที่ใช้, ผู้ตรวจสอบ และ session แต่ละวัน
- **บันทึก Checklist** — บันทึกผล finding (Conformity / OBS / OFI / NC-Minor / NC-Major) พร้อม evidence และ notes
- **นำเข้า/ส่งออก Excel** — Import checklist จากไฟล์ Excel หรือ Export ผลออกมาได้ทันที
- **ติดตาม Corrective Action** — สร้างและติดตาม CAR (Corrective Action Request) จาก Dashboard
- **จัดการ User** — ระบบ role-based: Admin / Auditor / Viewer

### Tech Stack

| ส่วน | เทคโนโลยี |
|------|-----------|
| Framework | [Next.js 16](https://nextjs.org/) (App Router, Turbopack) |
| UI | [Tailwind CSS v4](https://tailwindcss.com/) |
| Language | TypeScript 5 |
| Database & Auth | [Supabase](https://supabase.com/) (PostgreSQL + Auth) |
| Hosting | [Vercel](https://vercel.com/) |
| Excel | [xlsx (SheetJS)](https://sheetjs.com/) |

### โครงสร้างไฟล์สำคัญ

```
audit-tool/
├── app/
│   ├── audit-plan/          # หน้าวางแผน Audit
│   │   ├── page.tsx         # รายการ Audit Plans
│   │   └── [id]/page.tsx    # รายละเอียด + Plan Sessions
│   ├── checklist/           # หน้า Checklist
│   │   ├── page.tsx         # ตาราง checklist + filter by session
│   │   └── ImportModal.tsx  # modal สำหรับ Import Excel
│   ├── dashboard/
│   │   └── page.tsx         # สรุปสถานะ + Corrective Actions
│   ├── settings/
│   │   └── users/           # จัดการ User (Admin only)
│   ├── login/page.tsx       # หน้า Login
│   └── auth/
│       ├── confirm/         # callback สำหรับ email verification
│       └── set-password/    # หน้าเปลี่ยนรหัสผ่าน (first-login)
├── components/
│   ├── Navbar.tsx           # Navigation bar พร้อม role guard
│   ├── Modal.tsx            # Reusable modal component
│   └── PageLoader.tsx       # Loading spinner + elapsed timer
├── contexts/
│   └── AuthContext.tsx      # Auth state + role flags (canEditChecklist ฯลฯ)
├── lib/
│   ├── store.ts             # CRUD functions ทั้งหมด (Supabase + cache + timeout)
│   ├── supabase.ts          # Browser-side Supabase client
│   ├── supabase-server.ts   # Server-side Supabase client (Server Actions)
│   └── types.ts             # TypeScript interfaces ทั้งหมด
├── proxy.ts                 # Route guard (Next.js 16 Proxy)
└── supabase/                # SQL schema สำหรับสร้าง database
```

### Database Tables

| Table | ใช้เก็บ |
|-------|--------|
| `profiles` | ข้อมูล user (role, name, must_change_password) |
| `audit_plans` | Audit Plan header |
| `plan_sessions` | Session แต่ละวันของ Audit Plan |
| `checklist_items` | Checklist finding แต่ละ item |
| `corrective_actions` | CAR ที่เชื่อมกับ checklist item |
| `checklist_templates` | Template คำถามที่บันทึกไว้ |

> ตาราง `audit_plans`, `plan_sessions`, `checklist_items`, `corrective_actions`, `checklist_templates` ใช้ schema `{ id: UUID, data: JSONB }` เพื่อความยืดหยุ่น ไม่ต้อง migrate เมื่อเพิ่ม field

### Roles และ Permission

| Role | สิ่งที่ทำได้ |
|------|-------------|
| **Admin** | ทุกอย่าง รวมถึงจัดการ User และ Audit Plan |
| **Auditor** | สร้าง/แก้ไข Checklist และ Corrective Action |
| **Viewer** | ดูข้อมูลได้อย่างเดียว (ไม่เห็น Checklist tab) |

---

### Setup — รัน Project ในเครื่องตัวเอง

#### 1. Clone และติดตั้ง dependencies

```bash
git clone https://github.com/<your-org>/audit-tool.git
cd audit-tool
npm install
```

#### 2. สร้างไฟล์ `.env.local`

```bash
cp .env.example .env.local
```

แก้ไข `.env.local` ใส่ค่าจาก Supabase project ของคุณ (ดูรายละเอียดใน [.env.example](.env.example))

#### 3. สร้าง Database Schema

ไปที่ Supabase Dashboard → **SQL Editor** แล้วรัน SQL ในโฟลเดอร์ `supabase/` ตามลำดับ:

```
supabase/auth-schema.sql      # profiles table + trigger
supabase/app-schema.sql       # audit_plans, checklist_items ฯลฯ
```

#### 4. รัน Development Server

```bash
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000) ใน browser

#### 5. สร้าง Admin User แรก

ไปที่ Supabase Dashboard → **Authentication → Users → Invite user**  
จากนั้นไปที่ **Table Editor → profiles** แล้วเปลี่ยน `role` เป็น `admin`

---

### Deploy ขึ้น Vercel

#### วิธีที่ 1: ผ่าน GitHub Integration (แนะนำ)

1. Push code ขึ้น GitHub
2. ไปที่ [vercel.com](https://vercel.com) → **New Project** → เลือก repo
3. ตั้ง **Environment Variables** ใน Vercel Dashboard → Settings → Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. กด **Deploy**

#### วิธีที่ 2: ผ่าน Vercel CLI

```bash
npm i -g vercel
vercel --prod
```

> **สำคัญ**: `SUPABASE_SERVICE_ROLE_KEY` เป็น secret — อย่า commit ขึ้น git และอย่าตั้งเป็น `NEXT_PUBLIC_` prefix เด็ดขาด

---

### เพิ่ม Feature ใหม่

#### เพิ่ม Field ใน Data Model

1. แก้ interface ใน `lib/types.ts`
2. ถ้าเป็น field ใน `data` JSONB — ไม่ต้อง migrate database (Schemaless JSONB)
3. ถ้าต้องการ column จริงๆ — รัน `ALTER TABLE` ใน Supabase SQL Editor

#### เพิ่ม CRUD Function

เพิ่มใน `lib/store.ts` ตาม pattern เดิม:

```typescript
export async function getMyData(): Promise<MyType[]> {
  const { data, error } = await withTimeout(
    supabase.from('my_table').select('id, data'),
  );
  if (error) throw pgErr(error);
  return (data ?? []).map(r => fromRow<MyType>(r as DataRow));
}
```

#### เพิ่ม Page ใหม่

สร้าง `app/<route>/page.tsx` พร้อม `'use client'` directive  
ใช้ `useAuth()` สำหรับ role check:

```typescript
const { canEditChecklist, isAdmin } = useAuth();
```

---

## English

### What is this?

Audit Tool is a web application for managing internal audits against **ISO 27001:2022** and **NIST CSF 2.0** standards. It covers the full audit lifecycle: planning, checklist recording, Excel import/export, corrective action tracking, and role-based user management.

### Quick Start

```bash
git clone https://github.com/<your-org>/audit-tool.git
cd audit-tool
npm install
cp .env.example .env.local   # fill in your Supabase credentials
# Run supabase/auth-schema.sql then supabase/app-schema.sql in Supabase SQL Editor
npm run dev
```

### Deploy to Vercel

Set these environment variables in **Vercel → Settings → Environment Variables**:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — server-only, never expose to client |

Then connect your GitHub repo to Vercel and deploy. Every push to `main` triggers a production deployment automatically.

### User Roles

| Role | Permissions |
|------|-------------|
| **Admin** | Full access including user management and audit plan creation |
| **Auditor** | Create/edit checklists and corrective actions |
| **Viewer** | Read-only access (Checklist tab hidden) |

---

## License

Internal use only. Not for public distribution.
