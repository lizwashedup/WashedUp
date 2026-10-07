import csv
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("exporter", Path(__file__).with_name("export-onboarding-resend.py"))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportTest(unittest.TestCase):
    def test_phone_registered_profile_email_is_included(self):
        rows, skipped = exporter.contacts_for_profiles([{"email": "  Aster@Example.test ", "marketing_opt_in": "true"}])
        self.assertEqual(rows[0]["email"], "aster@example.test")
        self.assertEqual(rows[0]["unsubscribed"], "false")
        self.assertEqual(skipped, 0)

    def test_opt_out_and_unknown_consent_remain_included_unsubscribed(self):
        for value in (None, "", "false", "f", "0", "unexpected"):
            rows, _ = exporter.contacts_for_profiles([{"email": "aster@example.test", "marketing_opt_in": value}])
            self.assertEqual(rows[0]["unsubscribed"], "true")

    def test_duplicates_cannot_override_an_opt_out(self):
        profiles = [{"email": "aster@example.test", "marketing_opt_in": "false"}, {"email": "ASTER@example.test", "marketing_opt_in": "true"}]
        for ordered in (profiles, profiles[::-1]):
            rows, _ = exporter.contacts_for_profiles(ordered)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["unsubscribed"], "true")

    def test_existing_resend_unsubscribe_wins(self):
        rows, _ = exporter.contacts_for_profiles([{"email": "aster@example.test", "marketing_opt_in": "true"}], [{"email": "ASTER@example.test", "unsubscribed": "true"}])
        self.assertEqual(rows[0]["unsubscribed"], "true")

    def test_invalid_emails_are_counted_without_contact_output(self):
        rows, skipped = exporter.contacts_for_profiles([{"email": v} for v in (None, "", "not-email", "a b@example.test", "=cmd@example.test")])
        self.assertEqual(rows, [])
        self.assertEqual(skipped, 5)

    def test_csv_roundtrip_privacy_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, target = root / "profiles.csv", root / "resend.csv"
            name = 'Cedar, "Sun"\nRiver'
            with source.open("w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=["email", "marketing_opt_in", "first_name_display", "last_name"])
                writer.writeheader()
                writer.writerow({"email": "cedar@example.test", "marketing_opt_in": "true", "first_name_display": name, "last_name": "=1+1"})
            result = exporter.export(source, target)
            self.assertEqual(result["contacts"], 1)
            self.assertEqual(result["provider_calls"], 0)
            with target.open(newline="") as f:
                reader = csv.DictReader(f)
                self.assertEqual(reader.fieldnames, list(exporter.FIELDS))
                row = next(reader)
                self.assertEqual(row["first_name"], name)
                self.assertEqual(row["last_name"], "'=1+1")
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            previous = target.read_bytes()
            with self.assertRaises(FileExistsError):
                exporter.export(source, target)
            self.assertEqual(target.read_bytes(), previous)
            with self.assertRaises(FileExistsError):
                exporter.export(source, source)

    def test_email_only_archive_is_not_consent_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "emails.csv"
            source.write_text("email\naster@example.test\n")
            with self.assertRaises(ValueError):
                exporter.export(source, Path(directory) / "output.csv")


if __name__ == "__main__":
    unittest.main()
