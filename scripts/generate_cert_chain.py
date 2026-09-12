#!/usr/bin/env python3
"""
generate_cert_chain.py

Create a private CA root and TLS server certificate bundle from a JSON
configuration (see certs/private-ca/cert-config.template.json).

Outputs:
  <prefix>-root-ca.key          (PEM, unencrypted)
  <prefix>-root-ca.crt          (PEM)
  <prefix>-root-ca.cer          (DER, installable on iOS/macOS)
  <prefix>-server.key           (PEM, unencrypted)
  <prefix>-server.crt           (PEM)
  <prefix>-server-fullchain.crt (PEM, leaf + root)
  <prefix>-server.p12           (PKCS#12 bundle, protected with supplied
                                 password)
  <prefix>-server.cnf           (OpenSSL config with SANs, retained for
                                 reference)

Existing files are never overwritten unless the --force flag is passed.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

DEFAULT_TEMPLATE = Path("certs/private-ca/cert-config.template.json")


def build_subject(fields: Dict[str, str]) -> str:
    """Compose an OpenSSL-friendly subject string from config fields."""
    common_name = fields.get("common_name")
    if not isinstance(common_name, str) or not common_name.strip():
        raise ValueError("Subject must include a non-empty common_name")
    mapping: List[Tuple[str, str]] = [
        ("C", "country"),
        ("ST", "state"),
        ("L", "locality"),
        ("O", "organization"),
        ("OU", "organizational_unit"),
        ("CN", "common_name"),
    ]
    parts = []
    for code, key in mapping:
        value = fields.get(key)
        if value:
            parts.append(f"/{code}={value}")
    return "".join(parts)


def run(cmd: List[str], *, cwd: Path, check: bool = True) -> None:
    """Execute a shell command and stream output."""
    subprocess.run(cmd, cwd=cwd, check=check)


def ensure_empty(paths: Iterable[Path], *, force: bool) -> None:
    """Abort if any path already exists (unless --force)."""
    conflicts = [p for p in paths if p.exists()]
    if conflicts and not force:
        names = "\n  ".join(str(p) for p in conflicts)
        raise FileExistsError(
            f"Refusing to overwrite existing files:\n  {names}\n"
            "Use --force to replace them (or adjust output_dir / prefix)."
        )


def write_server_config(
    path: Path, subject: Dict[str, str], san_dns: List[str], san_ips: List[str]
) -> None:
    """Emit an OpenSSL request config that defines SAN entries."""
    if not san_dns and not san_ips:
        raise ValueError("At least one SAN entry (DNS or IP) is required.")
    lines = [
        "[ req ]",
        "default_bits = 2048",
        "prompt = no",
        "default_md = sha256",
        "req_extensions = req_ext",
        "distinguished_name = dn",
        "",
        "[ dn ]",
    ]
    subject_fields = {
        "C": subject.get("country"),
        "ST": subject.get("state"),
        "L": subject.get("locality"),
        "O": subject.get("organization"),
        "OU": subject.get("organizational_unit"),
        "CN": subject.get("common_name"),
    }
    for code, value in subject_fields.items():
        if value:
            lines.append(f"{code} = {value}")
    lines.extend(
        [
            "",
            "[ req_ext ]",
            "basicConstraints = critical, CA:FALSE",
            "keyUsage = critical, digitalSignature, keyEncipherment",
            "extendedKeyUsage = serverAuth",
            "subjectAltName = @alt_names",
            "",
            "[ alt_names ]",
        ]
    )
    index = 1
    for dns in san_dns:
        lines.append(f"DNS.{index} = {dns}")
        index += 1
    for ip in san_ips:
        lines.append(f"IP.{index - len(san_dns)} = {ip}")
        index += 1

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def generate_certificates(config_path: Path, *, force: bool) -> None:
    with config_path.open("r", encoding="utf-8") as handle:
        cfg = json.load(handle)

    output_dir = Path(cfg["output_dir"]).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    prefix = cfg.get("file_prefix", "cert")
    ca_cfg = cfg["ca"]
    server_cfg = cfg["server"]
    pkcs12_cfg = cfg.get("pkcs12", {})

    ca_subject = build_subject(ca_cfg)
    # Validate server subject fields early for clearer user errors.
    build_subject(server_cfg)

    san_dns: List[str] = server_cfg.get("san_dns", [])
    san_ips: List[str] = server_cfg.get("san_ips", [])

    server_conf_path = output_dir / f"{prefix}-server.cnf"
    root_key_path = output_dir / f"{prefix}-root-ca.key"
    root_crt_path = output_dir / f"{prefix}-root-ca.crt"
    root_der_path = output_dir / f"{prefix}-root-ca.cer"
    root_serial_path = output_dir / f"{prefix}-root-ca.srl"

    server_key_path = output_dir / f"{prefix}-server.key"
    server_csr_path = output_dir / f"{prefix}-server.csr"
    server_crt_path = output_dir / f"{prefix}-server.crt"
    fullchain_path = output_dir / f"{prefix}-server-fullchain.crt"
    pkcs12_path = output_dir / f"{prefix}-server.p12"

    targets = [
        root_key_path,
        root_crt_path,
        root_der_path,
        server_key_path,
        server_csr_path,
        server_crt_path,
        fullchain_path,
        pkcs12_path,
        server_conf_path,
        root_serial_path,
    ]
    ensure_empty(targets, force=force)
    write_server_config(server_conf_path, server_cfg, san_dns, san_ips)

    ca_days = int(ca_cfg.get("valid_days", 3650))
    ca_key_bits = int(ca_cfg.get("key_bits", 4096))
    server_days = int(server_cfg.get("valid_days", 825))
    server_key_bits = int(server_cfg.get("key_bits", 2048))
    pkcs12_password = pkcs12_cfg.get("password", "")

    # Root CA key and certificate.
    run(
        ["openssl", "genrsa", "-out", str(root_key_path), str(ca_key_bits)],
        cwd=output_dir,
    )
    run(
        [
            "openssl",
            "req",
            "-x509",
            "-new",
            "-key",
            str(root_key_path),
            "-sha256",
            "-days",
            str(ca_days),
            "-out",
            str(root_crt_path),
            "-subj",
            ca_subject,
            "-addext",
            "basicConstraints=critical,CA:TRUE,pathlen:1",
            "-addext",
            "keyUsage=critical,keyCertSign,cRLSign",
            "-addext",
            "subjectKeyIdentifier=hash",
        ],
        cwd=output_dir,
    )
    run(
        [
            "openssl",
            "x509",
            "-in",
            str(root_crt_path),
            "-outform",
            "der",
            "-out",
            str(root_der_path),
        ],
        cwd=output_dir,
    )

    # Server key, signing request, and signed certificate.
    run(
        [
            "openssl",
            "genrsa",
            "-out",
            str(server_key_path),
            str(server_key_bits),
        ],
        cwd=output_dir,
    )
    run(
        [
            "openssl",
            "req",
            "-new",
            "-key",
            str(server_key_path),
            "-out",
            str(server_csr_path),
            "-config",
            str(server_conf_path),
        ],
        cwd=output_dir,
    )
    run(
        [
            "openssl",
            "x509",
            "-req",
            "-in",
            str(server_csr_path),
            "-CA",
            str(root_crt_path),
            "-CAkey",
            str(root_key_path),
            "-CAcreateserial",
            "-out",
            str(server_crt_path),
            "-days",
            str(server_days),
            "-sha256",
            "-extfile",
            str(server_conf_path),
            "-extensions",
            "req_ext",
        ],
        cwd=output_dir,
    )

    # Full certificate chain and PKCS#12 bundle.
    with fullchain_path.open("w", encoding="utf-8") as chain_file:
        chain_file.write(server_crt_path.read_text(encoding="utf-8"))
        chain_file.write(root_crt_path.read_text(encoding="utf-8"))

    pkcs12_cmd = [
        "openssl",
        "pkcs12",
        "-export",
        "-inkey",
        str(server_key_path),
        "-in",
        str(server_crt_path),
        "-certfile",
        str(root_crt_path),
        "-out",
        str(pkcs12_path),
    ]
    if pkcs12_password:
        pkcs12_cmd.extend(["-passout", f"pass:{pkcs12_password}"])
    else:
        pkcs12_cmd.extend(["-passout", "pass:"])
    run(pkcs12_cmd, cwd=output_dir)

    # Retain the signing request only when requested.
    if not cfg.get("keep_csr", False):
        server_csr_path.unlink(missing_ok=True)

    print("Generated certificate bundle:")
    for path in [
        root_key_path,
        root_crt_path,
        root_der_path,
        server_key_path,
        server_crt_path,
        fullchain_path,
        pkcs12_path,
        server_conf_path,
    ]:
        print(f"  {path}")


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a private CA and TLS server certificate chain."
    )
    parser.add_argument(
        "-c",
        "--config",
        type=Path,
        default=DEFAULT_TEMPLATE,
        help="Path to the JSON config template to use.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow overwriting existing files in the output directory.",
    )
    return parser.parse_args(argv)


def main(argv: List[str]) -> int:
    args = parse_args(argv)
    config_path = args.config.expanduser().resolve()
    if not config_path.exists():
        print(f"Config file not found: {config_path}", file=sys.stderr)
        return 1
    try:
        generate_certificates(config_path, force=args.force)
    except (
        FileExistsError,
        ValueError,
        KeyError,
        json.JSONDecodeError,
        OSError,
        subprocess.CalledProcessError,
    ) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
