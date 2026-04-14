{
  description = "Consilium MVP dev environment (PopOS + Nix Flakes)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";

      overlay = final: prev:
        let
          awsQVersion = "1.19.7";
          ralphexVersion = "0.26.3";
        in {
          aws-q-cli = prev.stdenv.mkDerivation rec {
            pname = "aws-q-cli";
            version = awsQVersion;

            src = prev.fetchurl {
              url = "https://desktop-release.q.us-east-1.amazonaws.com/${version}/q-x86_64-linux-musl.tar.gz";
              hash = "sha256-S98fz9aRaoU9j3gmdk1XaIX3g3ODiRkhn7qH0RetJSo=";
            };

            sourceRoot = "q";
            dontConfigure = true;
            dontBuild = true;

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/bin" "$out/share/aws-q-cli"
              cp -r . "$out/share/aws-q-cli/"

              install -m755 bin/q "$out/bin/q"
              install -m755 bin/qchat "$out/bin/qchat"
              install -m755 bin/qterm "$out/bin/qterm"
              ln -s "$out/bin/q" "$out/bin/amazon-q"
              runHook postInstall
            '';

            meta = with prev.lib; {
              description = "AWS Q Developer CLI (official prebuilt binary)";
              homepage = "https://aws.amazon.com/q/developer/";
              platforms = [ "x86_64-linux" ];
              license = licenses.unfree;
            };
          };

          ralphex = prev.stdenv.mkDerivation rec {
            pname = "ralphex";
            version = ralphexVersion;

            src = prev.fetchurl {
              url = "https://github.com/umputun/ralphex/releases/download/v${version}/ralphex_${version}_linux_amd64.tar.gz";
              hash = "sha256-PiHRygCJtSsV23fjrJvwA73NsQgZDKYyaku5bhgT4so=";
            };

            sourceRoot = ".";
            dontConfigure = true;
            dontBuild = true;

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/bin"
              install -m755 ralphex "$out/bin/ralphex"
              runHook postInstall
            '';

            meta = with prev.lib; {
              description = "Ralphex CLI";
              homepage = "https://github.com/umputun/ralphex";
              platforms = [ "x86_64-linux" ];
              license = licenses.mit;
            };
          };
        };

      lib = nixpkgs.lib;

      pkgs = import nixpkgs {
        inherit system;
        overlays = [ overlay ];
        config.allowUnfreePredicate = pkg:
          builtins.elem (lib.getName pkg) [ "aws-q-cli" ];
      };

      python = pkgs.python311;
    in {
      devShells.${system} =
        let
          shell = pkgs.mkShell {
            packages = [
              python
              pkgs.google-cloud-sdk
              pkgs.aws-q-cli
              pkgs.ralphex
              pkgs.stdenv.cc.cc.lib
              pkgs.patchelf
              pkgs.coreutils
              pkgs.gawk
            ];

            shellHook = ''
              set -e

              PROJECT_ROOT="$(pwd)"
              VENV_DIR="$PROJECT_ROOT/.venv"
              REQ_FILE="$PROJECT_ROOT/requirements.txt"
              REQ_MARKER="$VENV_DIR/.requirements.sha256"

              if [ ! -x "$VENV_DIR/bin/python3" ]; then
                echo "[consilium] creating .venv from flake python"
                ${python}/bin/python3 -m venv "$VENV_DIR"
              fi

              # shellcheck disable=SC1091
              source "$VENV_DIR/bin/activate"

              if [ -f "$REQ_FILE" ]; then
                current_hash="$(sha256sum "$REQ_FILE" | awk '{print $1}')"
                previous_hash=""
                if [ -f "$REQ_MARKER" ]; then
                  previous_hash="$(cat "$REQ_MARKER")"
                fi

                if [ "$current_hash" != "$previous_hash" ]; then
                  echo "[consilium] installing requirements.txt"
                  python -m pip install --upgrade pip setuptools wheel
                  pip install -r "$REQ_FILE"
                  printf '%s' "$current_hash" > "$REQ_MARKER"
                else
                  echo "[consilium] requirements unchanged; skipping pip install"
                fi
              fi

              # grpc wheel expects libstdc++.so.6; patch RPATH in-place for nix shell portability.
              grpc_lib_dir="${pkgs.stdenv.cc.cc.lib}/lib"
              for so in "$VENV_DIR"/lib/python*/site-packages/grpc/_cython/cygrpc*.so; do
                [ -e "$so" ] || continue
                current_rpath="$(patchelf --print-rpath "$so" 2>/dev/null || true)"
                case ":$current_rpath:" in
                  *":$grpc_lib_dir:"*) ;;
                  *)
                    if [ -n "$current_rpath" ]; then
                      patchelf --set-rpath "$grpc_lib_dir:$current_rpath" "$so"
                    else
                      patchelf --set-rpath "$grpc_lib_dir" "$so"
                    fi
                    ;;
                esac
              done

              py_ver="$(python3 --version 2>/dev/null | awk '{print $2}')"
              q_ver="$(q --version 2>/dev/null | head -n1 || true)"
              gc_ver="$(gcloud --version 2>/dev/null | head -n1 || true)"
              rh_ver="$(ralphex --version 2>/dev/null | head -n1 || true)"
              if [ -z "$rh_ver" ]; then
                rh_ver="ralphex ready"
              fi
              echo "[consilium] python=$py_ver | $gc_ver | $q_ver | $rh_ver"
            '';
          };
        in {
          default = shell;
          devShell = shell;
        };
    };
}
