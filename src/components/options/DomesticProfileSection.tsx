import { useEffect, useState } from 'react';
import { CHINA_PROVINCES } from '@/src/data/chinaProvinces';
import { useToast } from '@/src/components/ui/useToast';
import { EMPTY_DOMESTIC_PROFILE, type ChinaRegion, type DomesticProfile } from '@/src/types/domesticProfile';
import { getDomesticProfile, saveDomesticProfile } from '@/src/utils/storage';
import { fieldCls as cls } from './shared/fieldCls';
import { FormField } from './shared/FormField';
import { SaveButton } from './shared/SaveButton';

const POLITICAL_STATUSES = ['中共党员', '中共预备党员', '共青团员', '群众', '民主党派', '无党派人士', '其他'];
const MARITAL_STATUSES = ['未婚', '已婚', '离异', '丧偶', '其他'];

function isValidNationalId(value: string): boolean {
  if (!value) return true;
  if (/^\d{15}$/.test(value)) return true;
  if (!/^\d{17}[\dXx]$/.test(value)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = value.slice(0, 17).split('').reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  return checks[sum % 11] === value[17].toUpperCase();
}

function RegionFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ChinaRegion;
  onChange: (value: ChinaRegion) => void;
}) {
  return (
    <div className="mb-4">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <select className={cls()} value={value.province} onChange={(event) => onChange({ ...value, province: event.target.value })}>
          <option value="">选择省份</option>
          {CHINA_PROVINCES.map((province) => <option key={province} value={province}>{province}</option>)}
        </select>
        <input className={cls()} value={value.city} onChange={(event) => onChange({ ...value, city: event.target.value })} placeholder="城市，例如：汕头市" maxLength={40} />
      </div>
    </div>
  );
}

export function DomesticProfileSection() {
  const [form, setForm] = useState<DomesticProfile>(EMPTY_DOMESTIC_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showNationalId, setShowNationalId] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { showToast } = useToast();

  useEffect(() => {
    getDomesticProfile()
      .then(setForm)
      .catch(() => showToast('error', '读取本机资料失败'))
      .finally(() => setLoading(false));
  }, [showToast]);

  const set = <K extends keyof DomesticProfile>(key: K, value: DomesticProfile[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (form.heightCm != null && (form.heightCm < 80 || form.heightCm > 250)) next.heightCm = '身高应在 80–250 厘米之间';
    if (form.weightKg != null && (form.weightKg < 20 || form.weightKg > 300)) next.weightKg = '体重应在 20–300 千克之间';
    if (!isValidNationalId(form.nationalId.trim())) next.nationalId = '身份证号码格式或校验位不正确';
    if (form.qq && !/^\d{5,12}$/.test(form.qq)) next.qq = 'QQ 号应为 5–12 位数字';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await saveDomesticProfile({
        ...form,
        politicalStatus: form.politicalStatus.trim(),
        maritalStatus: form.maritalStatus.trim(),
        qq: form.qq.trim(),
        wechat: form.wechat.trim(),
        nationalId: form.nationalId.trim().toUpperCase(),
        emergencyContact: {
          name: form.emergencyContact.name.trim(),
          relationship: form.emergencyContact.relationship.trim(),
          phone: form.emergencyContact.phone.trim(),
        },
      });
      showToast('success', '国内秋招资料已保存到本机');
    } catch {
      showToast('error', '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handlePhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', '请选择 JPG、PNG 等图片文件');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('error', '照片大小不能超过 5 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      set('photo', { name: file.name, size: file.size, base64: reader.result });
    };
    reader.onerror = () => showToast('error', '读取照片失败，请重试');
    reader.readAsDataURL(file);
  };

  if (loading) return <div className="h-40 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">国内秋招资料</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">这些字段仅保存在本机，不会同步到 Google Drive，也不会包含在默认导出文件中。</p>
      </div>

      <FormField label="求职照片 / 证件照" hint="仅保存在本机；自动填写头像、证件照或个人照片上传项，不会作为简历附件上传。">
        <div className="flex items-center gap-4 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          {form.photo?.base64 ? (
            <img src={form.photo.base64} alt="求职照片预览" className="h-20 w-16 rounded object-cover border border-gray-200 dark:border-gray-700" />
          ) : (
            <div className="h-20 w-16 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-400">未选择</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{form.photo?.name ?? '支持 JPG、PNG，最大 5 MB'}</p>
            <div className="mt-2 flex gap-2">
              <label className="cursor-pointer rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700">
                选择照片
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => handlePhoto(event.target.files?.[0])} />
              </label>
              {form.photo && (
                <button type="button" onClick={() => set('photo', undefined)} className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-700 dark:text-gray-300">移除</button>
              )}
            </div>
          </div>
        </div>
      </FormField>

      <RegionFields label="籍贯" value={form.nativePlace} onChange={(value) => set('nativePlace', value)} />
      <RegionFields label="户口所在地" value={form.householdRegistration} onChange={(value) => set('householdRegistration', value)} />
      <RegionFields label="生源地" value={form.studentOrigin} onChange={(value) => set('studentOrigin', value)} />

      <div className="grid grid-cols-2 gap-4">
        <FormField label="政治面貌"><select className={cls()} value={form.politicalStatus} onChange={(event) => set('politicalStatus', event.target.value)}><option value="">请选择</option>{POLITICAL_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></FormField>
        <FormField label="婚姻状况"><select className={cls()} value={form.maritalStatus} onChange={(event) => set('maritalStatus', event.target.value)}><option value="">请选择</option>{MARITAL_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="身高（厘米）" error={errors.heightCm}><input type="number" min={80} max={250} className={cls(errors.heightCm)} value={form.heightCm ?? ''} onChange={(event) => set('heightCm', event.target.value ? Number(event.target.value) : undefined)} /></FormField>
        <FormField label="体重（千克）" error={errors.weightKg}><input type="number" min={20} max={300} step="0.1" className={cls(errors.weightKg)} value={form.weightKg ?? ''} onChange={(event) => set('weightKg', event.target.value ? Number(event.target.value) : undefined)} /></FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="QQ" error={errors.qq}><input inputMode="numeric" className={cls(errors.qq)} value={form.qq} onChange={(event) => set('qq', event.target.value.replace(/\D/g, ''))} maxLength={12} /></FormField>
        <FormField label="微信号"><input className={cls()} value={form.wechat} onChange={(event) => set('wechat', event.target.value)} maxLength={50} /></FormField>
      </div>

      <FormField label="身份证号" error={errors.nationalId} hint="完整号码仅保存在本机；默认采用脱敏显示。">
        <div className="flex gap-2">
          <input type={showNationalId ? 'text' : 'password'} inputMode="text" className={cls(errors.nationalId)} value={form.nationalId} onChange={(event) => set('nationalId', event.target.value.replace(/\s/g, ''))} maxLength={18} autoComplete="off" />
          <button type="button" onClick={() => setShowNationalId((value) => !value)} className="shrink-0 px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300">{showNationalId ? '隐藏' : '显示'}</button>
        </div>
      </FormField>

      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 mt-6">紧急联系人</p>
      <div className="grid grid-cols-3 gap-3">
        <FormField label="姓名"><input className={cls()} value={form.emergencyContact.name} onChange={(event) => set('emergencyContact', { ...form.emergencyContact, name: event.target.value })} /></FormField>
        <FormField label="关系"><input className={cls()} value={form.emergencyContact.relationship} onChange={(event) => set('emergencyContact', { ...form.emergencyContact, relationship: event.target.value })} placeholder="例如：父亲" /></FormField>
        <FormField label="电话"><input className={cls()} value={form.emergencyContact.phone} onChange={(event) => set('emergencyContact', { ...form.emergencyContact, phone: event.target.value })} inputMode="tel" /></FormField>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700"><SaveButton onClick={handleSave} saving={saving} label="保存国内秋招资料" /></div>
    </div>
  );
}
