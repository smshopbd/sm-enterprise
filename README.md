<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# SM Enterprise

## Supabase ও Cloudinary কনফিগারেশন

প্রজেক্টের মূল ফোল্ডারের `.env.local` ফাইলে নিচের মানগুলো দিন:

| ভেরিয়েবল | কোথা থেকে পাবেন |
|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | একই পাতার public `anon`/publishable key |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary Dashboard-এর Cloud name |
| `CLOUDINARY_UPLOAD_PRESET` | Cloudinary-তে তৈরি করা unsigned upload preset-এর নাম |
| `CLOUDINARY_FOLDER` | Cloudinary-তে ছবির ঐচ্ছিক ফোল্ডার; ডিফল্ট `sm-enterprise` |

এরপর `npm run dev` দিয়ে চালান অথবা `npm run build` করে deploy করুন। এই কমান্ডগুলো স্বয়ংক্রিয়ভাবে `public/assets/cloud-config.json` তৈরি করবে; ফাইলটি উপেক্ষিত থাকে, তাই secret configuration source control-এ যোগ হয় না।

**নিরাপত্তা:** Angular অ্যাপ ব্রাউজারে চলে, তাই Supabase URL, public anon/publishable key, Cloudinary cloud name এবং unsigned preset build-এর পরও ব্যবহারকারীর কাছে দৃশ্যমান। `service_role` key বা Cloudinary API secret কখনো `.env.local`-এ দেবেন না।
