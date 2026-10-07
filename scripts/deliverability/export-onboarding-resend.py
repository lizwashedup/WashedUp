#!/usr/bin/env python3
"""Offline Resend CSV preparation from an authorized, current profiles CSV.
No database access, provider calls, uploads, or email sends.
"""
import argparse
import csv
import json
import os
from pathlib import Path
import re

FIELDS = ("email", "first_name", "last_name", "unsubscribed")
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def consent(value):
    return str(value or "").strip().lower() in ("true", "t", "1")


def csv_text(value):
    text = str(value or "").strip()
    # Keep spreadsheet formulas inert in optional names.
    if text.startswith(("=", "+", "-", "@")):
        text = "'" + text
    return text


def contacts_for_profiles(profiles, existing_contacts=()):
    contacts = {}
    suppressed = set()
    for row in existing_contacts:
        email = str(row.get("email") or "").strip().lower()
        if email and str(row.get("unsubscribed") or "").strip().lower() != "false":
            suppressed.add(email)
    skipped = 0
    for row in profiles:
        email = str(row.get("email") or "").strip().lower()
        if not EMAIL.fullmatch(email) or email.startswith(("=", "+", "-", "@")):
            skipped += 1
            continue
        unsubscribed = not consent(row.get("marketing_opt_in")) or email in suppressed
        contact = {
            "email": email,
            "first_name": csv_text(row.get("first_name_display")),
            "last_name": csv_text(row.get("last_name")),
            "unsubscribed": "true" if unsubscribed else "false",
        }
        previous = contacts.get(email)
        if previous:
            # Conflicting duplicate accounts must not turn an opt-out into consent.
            contact["unsubscribed"] = "true" if "true" in (
                contact["unsubscribed"], previous["unsubscribed"]
            ) else "false"
        contacts[email] = contact
    return [contacts[key] for key in sorted(contacts)], skipped


def read_csv(path, required):
    with path.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        if not set(required).issubset(reader.fieldnames or []):
            raise ValueError("Input is missing required column names: " + ", ".join(required))
        return list(reader)


def export(profiles_path, output_path, existing_path=None):
    profiles = read_csv(profiles_path, ("email", "marketing_opt_in"))
    existing = read_csv(existing_path, ("email", "unsubscribed")) if existing_path else []
    contacts, skipped = contacts_for_profiles(profiles, existing)
    if not contacts:
        raise ValueError("No valid onboarding emails to export")
    # Never overwrite the input, prior exports, or archived mailing lists.
    fd = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=FIELDS, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(contacts)
    return {"contacts": len(contacts), "unsubscribed": sum(
        row["unsubscribed"] == "true" for row in contacts
    ), "skipped_invalid_or_missing_email": skipped,
        "provider_calls": 0, "production_writes": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profiles", required=True, type=Path)
    parser.add_argument("--existing-resend", type=Path,
                        help="Optional current Resend export; prior opt-outs always win")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = export(args.profiles, args.output, args.existing_resend)
    except (OSError, ValueError, csv.Error):
        parser.exit(1, "Export failed. Check readable CSVs, required columns, valid emails, and a new output path.\n")
    print(json.dumps(result))  # Counters only; never print contact details.


if __name__ == "__main__":
    main()
