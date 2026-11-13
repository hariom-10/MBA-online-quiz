export const defaultCatalogCategories = [
  {
    id: "school-entrance-exams",
    name: "School & Entrance Exams",
    description: "School board and undergraduate entrance exam preparation",
    active: true,
  },
  {
    id: "government-exams",
    name: "Government Exams",
    description: "Central and state government recruitment exam preparation",
    active: true,
  },
  {
    id: "management-other-entrance-exams",
    name: "Management & Other Entrance Exams",
    description: "Management, law, engineering and other entrance exam preparation",
    active: true,
  },
];

export const defaultCatalogExams = [
  { id: "school-jee", categoryId: "school-entrance-exams", name: "JEE", description: "", active: true },
  { id: "school-neet", categoryId: "school-entrance-exams", name: "NEET", description: "", active: true },
  { id: "school-cuet", categoryId: "school-entrance-exams", name: "CUET", description: "", active: true },
  { id: "school-cbse", categoryId: "school-entrance-exams", name: "CBSE", description: "", active: true },
  { id: "school-state-board-exams", categoryId: "school-entrance-exams", name: "State Board Exams", description: "", active: true },
  { id: "government-ssc", categoryId: "government-exams", name: "SSC", description: "", active: true },
  { id: "government-railway", categoryId: "government-exams", name: "Railway", description: "", active: true },
  { id: "government-banking", categoryId: "government-exams", name: "Banking", description: "", active: true },
  { id: "government-upsc", categoryId: "government-exams", name: "UPSC", description: "", active: true },
  { id: "government-state-psc", categoryId: "government-exams", name: "State PSC", description: "", active: true },
  { id: "government-police", categoryId: "government-exams", name: "Police", description: "", active: true },
  { id: "government-defence", categoryId: "government-exams", name: "Defence", description: "", active: true },
  { id: "government-teaching-exams", categoryId: "government-exams", name: "Teaching Exams", description: "", active: true },
  { id: "government-judiciary-exams", categoryId: "government-exams", name: "Judiciary Exams", description: "", active: true },
  { id: "mba-cat", categoryId: "management-other-entrance-exams", name: "CAT", description: "Common Admission Test", active: true, quizExamId: "cat", moveFromCategoryId: "mba" },
  { id: "mba-mat", categoryId: "management-other-entrance-exams", name: "MAT", description: "Management Aptitude Test", active: true, quizExamId: "mat", moveFromCategoryId: "mba" },
  { id: "mba-xat", categoryId: "management-other-entrance-exams", name: "XAT", description: "Xavier Aptitude Test", active: true, quizExamId: "xat", moveFromCategoryId: "mba" },
  { id: "mba-cmat", categoryId: "management-other-entrance-exams", name: "CMAT", description: "Common Management Admission Test", active: true, quizExamId: "cmat", moveFromCategoryId: "mba" },
  { id: "management-clat", categoryId: "management-other-entrance-exams", name: "CLAT", description: "", active: true },
  { id: "management-gate", categoryId: "management-other-entrance-exams", name: "GATE", description: "", active: true },
  { id: "management-nift", categoryId: "management-other-entrance-exams", name: "NIFT", description: "", active: true },
  { id: "management-hotel-management", categoryId: "management-other-entrance-exams", name: "Hotel Management Entrance Exams", description: "", active: true },
];

export async function seedCatalogDefaults(db, collectionName, markerId, defaults, categoryIds = new Map()) {
  const collection = db.collection(collectionName);
  const markerRef = db.collection("platformMetadata").doc(markerId);
  await db.runTransaction(async (transaction) => {
    const marker = await transaction.get(markerRef);
    if (Number(marker.data()?.version ?? 0) >= 1) return;

    const categoryNames = collectionName === "examCategories"
      ? new Set((await transaction.get(collection)).docs.map((document) => String(document.data().name ?? "").trim().toLowerCase()))
      : null;
    const refs = defaults.map((item) => collection.doc(item.id));
    const existing = await transaction.getAll(...refs);
    const now = new Date().toISOString();
    defaults.forEach((item, index) => {
      const ref = refs[index];
      const snapshot = existing[index];
      const { moveFromCategoryId, ...defaultItem } = item;
      if (!snapshot.exists) {
        const categoryName = String(item.name ?? "").trim().toLowerCase();
        if (categoryNames?.has(categoryName)) return;
        const categoryId = categoryIds.get(item.categoryId) ?? item.categoryId;
        transaction.create(ref, {
          ...defaultItem,
          ...(categoryId ? { categoryId } : {}),
          order: index,
          createdAt: now,
          updatedAt: now,
        });
        categoryNames?.add(categoryName);
      } else if (moveFromCategoryId && snapshot.data().categoryId === moveFromCategoryId) {
        transaction.update(ref, {
          categoryId: categoryIds.get(item.categoryId) ?? item.categoryId,
          updatedAt: now,
        });
      }
    });
    transaction.set(markerRef, { version: 1, initializedAt: now }, { merge: true });
  });
}
