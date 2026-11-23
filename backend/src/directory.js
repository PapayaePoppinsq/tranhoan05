const timePattern = '(?:[01]\\d|2[0-3]):[03]0';
const ratePattern = new RegExp(`^(${timePattern})-(${timePattern}|24:00): (\\d+) VND/h$`);
const splitEntries = (value) => value.split('|').map((entry) => entry.trim());

export function readDirectoryDetails(row, open, close) {
  const invalid = () => new Error(`Chi tiết danh bạ không hợp lệ ở sân ${row.id}`);
  const readRates = (value) => {
    let previousEnd = open;
    const rates = splitEntries(value).map((entry) => {
      const match = ratePattern.exec(entry);
      if (!match) throw invalid();
      const [, start, end, price] = match;
      const hourly = Number(price);
      if (start !== previousEnd || end <= start || !Number.isSafeInteger(hourly) || hourly <= 0) throw invalid();
      previousEnd = end;
      return { start, end, hourly };
    });
    if (previousEnd !== close) throw invalid();
    return rates;
  };
  const courtCount = Number(row.so_luong_san_nho);
  const prices = {
    offPeak: Number(row.gia_thap_diem_vnd),
    peak: Number(row.gia_cao_diem_vnd),
    weekend: Number(row.gia_cuoi_tuan_vnd),
  };
  const courts = splitEntries(row.danh_sach_san_nho).map((entry) => {
    const match = /^(TN\d+-S\d+) - (.+)$/.exec(entry);
    if (!match) throw invalid();
    return { code:match[1], label:match[2] };
  });
  if (courtCount < 1 || courts.length !== courtCount || new Set(courts.map(({ code }) => code)).size !== courtCount ||
      !row.loai_san || !row.mat_san || Object.values(prices).some((price) => !Number.isSafeInteger(price) || price <= 0)) {
    throw invalid();
  }
  return { courtCount, courtType:row.loai_san, surface:row.mat_san, prices,
    weekdayRates:readRates(row.bang_gia_t2_t6), weekendRates:readRates(row.bang_gia_t7_cn), courts };
}
