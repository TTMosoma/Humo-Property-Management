import {
  CATEGORY_LABELS,
  COMPLIANCE_CATEGORIES,
  COMPLIANCE_TYPE,
  ComplianceType,
  DocumentVisibility,
  LibraryCategory,
  LibraryDataSource,
  LibraryDocument,
  RecordKind,
  SupplierDocType,
  VISIBILITY_LABELS,
} from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { FormField, FormValues, REASON_FIELD, openForm } from '../shared/form-drawer';

const SUPPLIER_DOCS: SupplierDocType[] = ['COIDA letter of good standing', 'Public liability insurance', 'Tax compliance (SARS PIN)', 'B-BBEE certificate', 'Bank confirmation letter'];

/** Who usually needs to see each kind of document. */
const DEFAULT_VISIBILITY: Record<LibraryCategory, DocumentVisibility> = {
  insurance: 'trustees',
  certificate: 'trustees',
  vetting: 'staff',
  rules: 'owners',
  minutes: 'trustees',
  financial: 'trustees',
  contract: 'staff',
  plans: 'trustees',
  correspondence: 'staff',
  quote: 'staff',
  photo: 'staff',
  other: 'staff',
};

/** The categories that make sense on each kind of record. */
function categoriesFor(kind: RecordKind): LibraryCategory[] {
  const all = Object.keys(CATEGORY_LABELS) as LibraryCategory[];
  if (kind === 'supplier') return ['vetting', 'contract', 'quote', 'correspondence', 'other'];
  return all.filter((c) => c !== 'vetting');
}

function visibilityOptions(kind: RecordKind) {
  return (Object.keys(VISIBILITY_LABELS) as DocumentVisibility[]).filter((v) => v !== 'unit' || kind === 'unit').map((v) => ({ value: v, label: VISIBILITY_LABELS[v] }));
}

const complianceFor = (category: string) =>
  (Object.entries(COMPLIANCE_CATEGORIES) as [ComplianceType, LibraryCategory][]).filter(([, c]) => c === category).map(([t]) => ({ value: t, label: COMPLIANCE_TYPE[t].label }));

const needsExpiry = (v: FormValues) => !!v['compliance'] || v['category'] === 'vetting' || v['category'] === 'insurance' || v['category'] === 'certificate';

export interface UploadPreset {
  category?: LibraryCategory;
  compliance?: ComplianceType;
  supplierDoc?: SupplierDocType;
  title?: string;
}

/** Upload a document on a record (pattern P5). It appears in the library with the link already set. */
export function uploadForm(drawer: DrawerService, data: LibraryDataSource, record: { kind: RecordKind; id: string; label: string }, preset: UploadPreset = {}): void {
  const category = preset.category ?? (record.kind === 'supplier' ? 'vetting' : 'other');
  const fields: FormField[] = [
    { key: 'file', label: 'File', type: 'file', required: true, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx', help: 'PDF, photos, Word or Excel. Humo checks the size limit.' },
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'What people will look for' },
    { key: 'category', label: 'Category', type: 'select', required: true, half: true, options: categoriesFor(record.kind).map((c) => ({ value: c, label: CATEGORY_LABELS[c] })) },
    { key: 'visibility', label: 'Who can see it', type: 'select', required: true, half: true, options: visibilityOptions(record.kind) },
    { key: 'supplierDoc', label: 'Vetting document', type: 'select', required: true, options: SUPPLIER_DOCS.map((d) => ({ value: d, label: d })), showIf: (v) => v['category'] === 'vetting' },
  ];
  if (record.kind === 'scheme') {
    fields.push({ key: 'compliance', label: 'Evidence for', type: 'select', help: 'Compliance tracks its expiry for this scheme.', optionsFor: (v) => complianceFor(v['category']), showIf: (v) => complianceFor(v['category']).length > 0 });
  }
  fields.push(
    { key: 'expiresAt', label: 'Expires', type: 'date', half: true, showIf: needsExpiry, help: 'Compliance warns 30 days before.' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  );

  openForm(drawer, {
    eyebrow: record.label,
    title: 'Upload a document',
    intro: 'It’s kept on this record and appears in the library. Insurance and certificates that are evidence for Compliance need their expiry date.',
    fields,
    initial: {
      category,
      visibility: record.kind === 'unit' ? 'unit' : DEFAULT_VISIBILITY[category],
      supplierDoc: preset.supplierDoc ?? '',
      compliance: preset.compliance ?? '',
      title: preset.title ?? preset.supplierDoc ?? '',
    },
    changed: (key, v) => {
      let next = v;
      if (key === 'file' && v['file'] && !v['title']) next = { ...next, title: v['file'].replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') };
      if (key === 'category') {
        const options = complianceFor(v['category']).map((o) => o.value as string);
        next = { ...next, visibility: record.kind === 'unit' ? 'unit' : DEFAULT_VISIBILITY[v['category'] as LibraryCategory], compliance: options.includes(v['compliance']) ? v['compliance'] : options.length === 1 && record.kind === 'scheme' ? options[0] : '' };
      }
      if (key === 'supplierDoc' && (!v['title'] || SUPPLIER_DOCS.includes(v['title'] as SupplierDocType))) next = { ...next, title: v['supplierDoc'] };
      return next;
    },
    submitLabel: 'Upload',
    submit: (v, files) =>
      data.upload(
        {
          title: v['title'],
          fileName: v['file'],
          mimeType: files['file']?.type ?? '',
          sizeBytes: files['file']?.size ?? 0,
          category: v['category'] as LibraryCategory,
          record: { kind: record.kind, id: record.id },
          visibility: v['visibility'] as DocumentVisibility,
          expiresAt: needsExpiry(v) && v['expiresAt'] ? v['expiresAt'] : undefined,
          compliance: (v['compliance'] || undefined) as ComplianceType | undefined,
          supplierDoc: v['category'] === 'vetting' ? (v['supplierDoc'] as SupplierDocType) : undefined,
          notes: v['notes'],
        },
        files['file'],
      ),
    success: (_id, v) => (v['compliance'] || v['category'] === 'vetting' ? `Uploaded. Compliance now tracks its expiry.` : 'Uploaded.'),
    failure: 'The document wasn’t uploaded',
  });
}

export function editDocumentForm(drawer: DrawerService, data: LibraryDataSource, d: LibraryDocument): void {
  const kind = d.links[0]?.kind ?? 'scheme';
  openForm(drawer, {
    eyebrow: d.fileName,
    title: 'Edit details',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'select', required: true, half: true, options: categoriesFor(kind).map((c) => ({ value: c, label: CATEGORY_LABELS[c] })) },
      { key: 'visibility', label: 'Who can see it', type: 'select', required: true, half: true, options: visibilityOptions(kind) },
      { key: 'expiresAt', label: 'Expires', type: 'date', half: true, help: d.compliance || d.supplierDoc ? 'Compliance tracks this date.' : undefined },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    initial: { title: d.title, category: d.category, visibility: d.visibility, expiresAt: d.expiresAt ? toDateField(d.expiresAt) : '', notes: d.notes ?? '' },
    submitLabel: 'Save',
    submit: (v) =>
      data.act(d.id, { type: 'edit', title: v['title'], category: v['category'] as LibraryCategory, visibility: v['visibility'] as DocumentVisibility, expiresAt: v['expiresAt'] || undefined, notes: v['notes'] }, d.version),
    success: () => 'Saved.',
    failure: 'The changes weren’t saved',
  });
}

export function archiveDocumentForm(drawer: DrawerService, data: LibraryDataSource, d: LibraryDocument): void {
  openForm(drawer, {
    eyebrow: d.title,
    title: 'Archive document',
    intro: d.compliance || d.supplierDoc ? 'Compliance stops counting it as evidence. It stays in the library under Archived and can be restored.' : 'It stays in the library under Archived and can be restored.',
    fields: [REASON_FIELD],
    submitLabel: 'Archive',
    submit: (v) => data.act(d.id, { type: 'archive', reason: v['reason'] }, d.version),
    success: () => 'Archived.',
    failure: 'The document wasn’t archived',
  });
}

/** ISO → yyyy-mm-dd in local time. */
export function toDateField(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
