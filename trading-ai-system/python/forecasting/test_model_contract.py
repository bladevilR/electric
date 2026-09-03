import unittest
from model_contract import validate_training_row, validate_forecast_output
class ContractTest(unittest.TestCase):
    def test_rejects_post_cutoff_feature(self):
        with self.assertRaisesRegex(ValueError, 'forbidden_feature'): validate_training_row({'split':'train','features':{'actualPriceFinalYuanPerMwh':320}})
    def test_quantiles_are_monotonic(self):
        with self.assertRaisesRegex(ValueError, 'quantile_order_invalid'): validate_forecast_output({'p10':330,'p50':320,'p90':340})
if __name__ == '__main__': unittest.main()
