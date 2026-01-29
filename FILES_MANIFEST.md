# 📋 React Native Project - Essential Files Checklist

## ✅ Files Required for React Native Build

```
✅ KEEP (React Native)
├── App.tsx                    # Main React Native component
├── index.ts                  # Expo entry point
├── app.json                  # Expo configuration
├── metro.config.js           # RN bundler
├── babel.config.js           # Babel config
├── tsconfig.json             # TypeScript config
├── package.json              # Dependencies
├── types.ts                  # Shared types
├── components/
│   ├── TelemetryCard.tsx
│   └── StatusLog.tsx
├── services/
│   ├── dataService.ts
│   ├── geminiService.ts
│   └── firebaseConfig.example.ts
├── assets/                   # (Placeholder for icons)
└── .gitignore               # Updated for RN

❌ DELETE (Old Web App - Backup Exists)
├── App.rn.tsx               # Duplicate, delete after moving to App.tsx
├── vite.config.ts           # Web-only, not needed
├── index.html              # Web-only, not needed  
├── index.tsx               # Old web entry, use index.ts instead
└── backup/                 # Old web files preserved for reference
```

## 🎯 What This Means

After deleting old files, you'll have a **clean React Native project** with:
- No Vite references
- No HTML files
- No duplicate App versions
- All React Native dependencies correctly set up

## 📝 Notes

- **index.ts** is the correct Expo entry point (not index.tsx)
- **App.tsx** is React Native version (not .rn variant)
- **All old files** are backed up in `/backup/` directory if needed
- **vite.config.ts** not used by React Native/Expo

## 🚀 Ready to Build When

1. ✅ `npm install` completes successfully
2. ✅ Firebase config added to `services/firebaseConfig.ts`
3. ✅ Old web files cleaned up
4. ✅ Run `npm start` or `npm run android`

---

**Status**: Ready for APK build once old files are cleaned  
**Next**: `npm install && npm run android`
