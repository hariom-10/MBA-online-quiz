import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultCatalogCategories,
  defaultCatalogExams,
  seedCatalogDefaults,
} from "../server/catalogDefaults.mjs";

class FakeDocumentReference {
  constructor(database, collectionName, id) {
    this.database = database;
    this.collectionName = collectionName;
    this.id = id;
    this.key = `${collectionName}/${id}`;
  }
}

class FakeCollectionReference {
  constructor(database, name) {
    this.database = database;
    this.name = name;
  }

  doc(id) {
    return new FakeDocumentReference(this.database, this.name, id);
  }
}

class FakeFirestore {
  documents = new Map();

  collection(name) {
    return new FakeCollectionReference(this, name);
  }

  async runTransaction(callback) {
    const writes = [];
    const snapshot = (reference) => ({
      exists: this.documents.has(reference.key),
      data: () => this.documents.get(reference.key),
    });
    const transaction = {
      get: async (reference) => {
        if (reference instanceof FakeCollectionReference) {
          const prefix = `${reference.name}/`;
          const docs = Array.from(this.documents.entries())
            .filter(([key]) => key.startsWith(prefix))
            .map(([, data]) => ({ data: () => data }));
          return { docs };
        }
        return snapshot(reference);
      },
      getAll: async (...references) => references.map(snapshot),
      create: (reference, data) => writes.push({ type: "create", reference, data }),
      update: (reference, data) => writes.push({ type: "update", reference, data }),
      set: (reference, data, options) => writes.push({ type: "set", reference, data, options }),
    };

    await callback(transaction);
    for (const write of writes) {
      const current = this.documents.get(write.reference.key);
      if (write.type === "create") {
        assert.equal(current, undefined, `duplicate create for ${write.reference.key}`);
        assert.ok(Object.values(write.data).every((value) => value !== undefined), "Firestore seed values cannot be undefined");
        this.documents.set(write.reference.key, write.data);
      } else if (write.type === "update") {
        this.documents.set(write.reference.key, { ...current, ...write.data });
      } else {
        this.documents.set(write.reference.key, write.options?.merge ? { ...current, ...write.data } : write.data);
      }
    }
  }
}

test("default catalog contains all requested active groups and exams", () => {
  assert.deepEqual(defaultCatalogCategories.map(({ name, active }) => [name, active]), [
    ["School & Entrance Exams", true],
    ["Government Exams", true],
    ["Management & Other Entrance Exams", true],
  ]);
  assert.equal(defaultCatalogExams.length, 22);
  assert.ok(defaultCatalogExams.every((exam) => exam.active));
  assert.equal(new Set(defaultCatalogCategories.map((category) => category.name.toLowerCase())).size, 3);
  assert.equal(new Set(defaultCatalogExams.map((exam) => exam.id)).size, 22);

  const expectedExams = {
    "school-entrance-exams": ["JEE", "NEET", "CUET", "CBSE", "State Board Exams"],
    "government-exams": ["SSC", "Railway", "Banking", "UPSC", "State PSC", "Police", "Defence", "Teaching Exams", "Judiciary Exams"],
    "management-other-entrance-exams": ["CAT", "MAT", "XAT", "CMAT", "CLAT", "GATE", "NIFT", "Hotel Management Entrance Exams"],
  };
  for (const [categoryId, examNames] of Object.entries(expectedExams)) {
    assert.deepEqual(
      defaultCatalogExams.filter((exam) => exam.categoryId === categoryId).map((exam) => exam.name),
      examNames,
    );
  }
});

test("default catalog seeding is additive, repeatable, and reuses linked MBA quiz entries", async () => {
  const db = new FakeFirestore();
  const existingCat = db.collection("platformExams").doc("mba-cat");
  db.documents.set(existingCat.key, {
    id: "mba-cat",
    categoryId: "mba",
    name: "CAT",
    description: "Common Admission Test",
    active: true,
    quizExamId: "cat",
    createdAt: "existing",
  });
  const categoryIds = new Map(defaultCatalogCategories.map((category) => [category.id, category.id]));

  await seedCatalogDefaults(db, "examCategories", "examCategoriesV2", defaultCatalogCategories);
  await seedCatalogDefaults(db, "platformExams", "platformExamsV2", defaultCatalogExams, categoryIds);
  await seedCatalogDefaults(db, "examCategories", "examCategoriesV2", defaultCatalogCategories);
  await seedCatalogDefaults(db, "platformExams", "platformExamsV2", defaultCatalogExams, categoryIds);

  const categories = Array.from(db.documents.entries())
    .filter(([key]) => key.startsWith("examCategories/"))
    .map(([, value]) => value);
  const exams = Array.from(db.documents.entries())
    .filter(([key]) => key.startsWith("platformExams/"))
    .map(([, value]) => value);
  assert.equal(categories.length, 3);
  assert.equal(exams.length, 22);
  assert.ok(exams.every((exam) => exam.active));
  assert.equal(exams.find((exam) => exam.id === "mba-cat").categoryId, "management-other-entrance-exams");
  assert.equal(exams.find((exam) => exam.id === "mba-cat").quizExamId, "cat");
  assert.equal(exams.find((exam) => exam.id === "mba-cat").createdAt, "existing");

  const studentPortalCatalog = categories.filter((category) => category.active).map((category) => ({
    name: category.name,
    exams: exams.filter((exam) => exam.categoryId === category.id && exam.active).map((exam) => exam.name),
  }));
  for (const [categoryId, examNames] of Object.entries({
    "school-entrance-exams": ["JEE", "NEET", "CUET", "CBSE", "State Board Exams"],
    "government-exams": ["SSC", "Railway", "Banking", "UPSC", "State PSC", "Police", "Defence", "Teaching Exams", "Judiciary Exams"],
    "management-other-entrance-exams": ["CAT", "MAT", "XAT", "CMAT", "CLAT", "GATE", "NIFT", "Hotel Management Entrance Exams"],
  })) {
    const category = categories.find((item) => item.id === categoryId);
    const portalCategory = studentPortalCatalog.find((item) => item.name === category.name);
    assert.ok(portalCategory, `${category.name} is visible in the Student Portal`);
    assert.deepEqual(portalCategory.exams, examNames);
  }
});

test("seeding skips a category whose name already exists and does not restore deleted defaults", async () => {
  const db = new FakeFirestore();
  db.documents.set("examCategories/custom-government", {
    id: "custom-government",
    name: "Government Exams",
    active: true,
  });

  await seedCatalogDefaults(db, "examCategories", "examCategoriesV2", defaultCatalogCategories);
  assert.equal(db.documents.has("examCategories/government-exams"), false);
  assert.equal(db.documents.has("examCategories/custom-government"), true);

  db.documents.delete("examCategories/school-entrance-exams");
  await seedCatalogDefaults(db, "examCategories", "examCategoriesV2", defaultCatalogCategories);
  assert.equal(db.documents.has("examCategories/school-entrance-exams"), false);
});
