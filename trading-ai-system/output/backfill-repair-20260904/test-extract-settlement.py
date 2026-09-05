import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('extractor', Path(__file__).with_name('extract-settlement-facts.py'))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


def source_rows():
    rows = [['2025年6月21日现货日清分核对单'], ['市场主体名称'], ['结算单元'], ['单位：兆瓦时、元、元/兆瓦时'],
            ['时段', '用电量', '实时偏差结算', None, None, None, None],
            [None, None, '电量', '电价', '电费', '电费', '电价']]
    for i in range(1, 97):
        rows.append([f'{i // 4:02}:{i % 4 * 15:02}', 2, 1, -20, -20, 500, 250])
    return rows


class ExtractionTests(unittest.TestCase):
    merged = [SimpleNamespace(min_row=5, min_col=3, max_col=5)]

    def test_merged_parent_disambiguates_settlement_price_and_preserves_negative_price(self):
        day = extractor.extract_sheet(source_rows(), self.merged)
        self.assertEqual(day['coverage']['realTimeSettlementPriceYuanPerMwh'], 96)
        self.assertEqual(day['values'][0]['value'], -20)
        self.assertEqual(day['values'][0]['sourceCell'], 'D7')
        self.assertNotIn('dayAheadUserPriceFinalYuanPerMwh', day['coverage'])

    def test_unknown_header_cannot_guess_a_price_column(self):
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            extractor.extract_sheet(source_rows())

    def test_price_must_reconcile_to_same_group_quantity_and_fee(self):
        rows = source_rows()
        rows[6][3] = 250
        with self.assertRaisesRegex(ValueError, 'reconciliation'):
            extractor.extract_sheet(rows, self.merged)

    def test_duplicate_interval_and_unconfirmed_units_rejected(self):
        rows = source_rows()
        rows[-1][0] = '23:45'
        with self.assertRaisesRegex(ValueError, 'Incomplete or duplicate'):
            extractor.extract_sheet(rows, self.merged)
        rows = source_rows()
        rows[3] = ['单位未知']
        with self.assertRaisesRegex(ValueError, 'Unknown units'):
            extractor.extract_sheet(rows, self.merged)


if __name__ == '__main__':
    unittest.main()
