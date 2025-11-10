import os
import argparse
import sys
import fnmatch # ファイル名パターンのマッチングに使用

# --- 除外設定 (ハードコーディング) ---
# ここを編集して除外したいファイルを設定してください

# 除外したいファイルの拡張子 (小文字、ドットを含む)
# 例: '.log', '.tmp', '.bak' など
EXCLUDE_EXTENSIONS = {
    '.log', '.tmp', '.bak', '.swp', '.swo', # 一般的な一時/バックアップファイル
    '.dll', '.exe', '.sys', '.bin', '.dat', # バイナリファイル (行数カウント非推奨)
    '.zip', '.rar', '.7z', '.gz', '.tar', '.iso', # アーカイブファイル
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg', # 画像ファイル
    '.mp3', '.wav', '.ogg', '.flac', '.mp4', '.avi', '.mov', '.mkv', # メディアファイル
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', # オフィス文書等
    '.pyc', # Pythonバイトコード
    '.pdb', '.obj', '.lib', '.a', '.o', '.so', # コンパイル/リンク関連ファイル
    '.class', '.jar', # Java関連
    '.sqlite', '.db', '.mdb', # データベースファイル
}

# 除外したいファイル名パターン (ワイルドカード * や ? を使用可能)
# 例: '*.bak', 'temp_*', '~$*' など
EXCLUDE_PATTERNS = [
    '~$*',           # Officeの一時ファイル
    '.DS_Store',     # macOS システムファイル
    'Thumbs.db',     # Windows システムファイル
    'ehthumbs.db',   # Windows システムファイル
    '*.lock',        # ロックファイル
    '.*.sw?',        # Vim swap files
    'package-lock.json', # npmのロックファイル
    # 特定のファイル名を除外したい場合もここに追加
    # 'specific_file_to_exclude.txt',
]

# 除外したいディレクトリ名 (再帰検索時にこの名前のディレクトリ以下は探索しない)
# 例: 'node_modules', '.git', 'venv' など
EXCLUDE_DIRS = {
    'node_modules',
    '.git',
    'venv',
    '.venv',
    '__pycache__',
    '.svn',
    '.hg',
    '.vscode',
    '.idea',
    'build',
    'dist',
    'target',
    'out',
    'bin', # プロジェクトによっては除外したい場合がある
    'obj', # 同上
    'backups', # プロジェクト固有のバックアップフォルダ
    'ARCHIVE', # プロジェクト固有のアーカイブフォルダ
}
# --- 除外設定 ここまで ---


def count_lines(filepath, encoding='utf-8', errors='ignore'):
    """
    ファイルの行数を効率的にカウントします。
    エンコーディングエラーが発生した場合、エラーを無視してカウントを試みます。
    """
    line_count = 0
    used_encoding = encoding # 実際に使ったエンコーディングを記録するため

    try:
        # まず指定されたエンコーディングで試す (Noneの場合はシステムのデフォルト)
        effective_encoding = encoding if encoding else sys.getdefaultencoding()
        used_encoding = effective_encoding
        with open(filepath, 'r', encoding=effective_encoding, errors='strict') as f:
            line_count = sum(1 for _ in f)
        return line_count
    except FileNotFoundError:
        return -1 # エラーを示す値 (-1)
    except PermissionError:
        # print(f"警告: アクセス権がありません: {filepath}", file=sys.stderr)
        return -2 # エラーを示す値 (-2)
    except UnicodeDecodeError:
        # 指定エンコーディングで失敗した場合、他の可能性を試す
        encodings_to_try = ['utf-8-sig', 'cp932', 'shift_jis', 'euc_jp'] # よく使われるもの
        if used_encoding in encodings_to_try:
            encodings_to_try.remove(used_encoding) # 既に試したものは除く

        for enc in encodings_to_try:
            try:
                with open(filepath, 'r', encoding=enc, errors='strict') as f:
                    line_count = sum(1 for _ in f)
                return line_count # 成功したら返す
            except (UnicodeDecodeError, LookupError): # LookupErrorは未知のエンコーディング指定時
                 continue # 次のエンコーディングへ
            except (PermissionError, FileNotFoundError):
                 return -2 # または -1
            except Exception: # その他のエラーは一旦無視して次へ
                 continue

        # 他のテキストエンコーディングでもダメだった場合
        # print(f"警告: テキストとしての読み込みに失敗 ({used_encoding} および試行した他のエンコーディング)。バイナリモードで試行: {filepath}", file=sys.stderr)

        # 最終手段: バイナリモードで改行コードを数える (精度は保証されない)
        try:
            count = 0
            with open(filepath, 'rb') as f:
                while True:
                    chunk = f.read(1024 * 1024) # 1MBずつ読み込む
                    if not chunk:
                        break
                    count += chunk.count(b'\n')
            # バイナリモードでカウントした場合は負の値で区別する（例: -100 - 行数）
            # ただし、今回はエラーの場合と区別するため、単に行数を返す（ただし信頼性は低い）
            # print(f"  -> バイナリモードでの推定: 約{count} 行", file=sys.stderr)
            return count
        except PermissionError:
            return -2
        except FileNotFoundError:
            return -1
        except Exception as e_bin:
            # print(f"警告: バイナリモードでの読み込みも失敗しました: {filepath} ({e_bin})", file=sys.stderr)
            return -3 # その他のエラー (-3)

    except Exception as e:
        # その他の予期せぬエラー
        # print(f"警告: ファイル '{filepath}' の処理中に予期せぬエラーが発生しました: {e}", file=sys.stderr)
        return -3 # その他のエラー (-3)


def is_excluded_file(filepath, filename):
    """指定されたファイルが除外対象かどうかを判定する"""
    _, ext = os.path.splitext(filename)
    ext_lower = ext.lower()

    # 拡張子で除外
    if ext_lower in EXCLUDE_EXTENSIONS:
        return True

    # ファイル名パターンで除外
    for pattern in EXCLUDE_PATTERNS:
        if fnmatch.fnmatch(filename, pattern):
            return True

    # スクリプト自体を除外
    try:
        # __file__ が未定義の場合や存在しないパスの場合にエラーになるのを防ぐ
        script_path = os.path.abspath(__file__)
        if '__file__' in globals() and os.path.exists(script_path) and os.path.samefile(filepath, script_path):
            return True
    except (OSError, NameError):
        pass # samefileエラーや__file__未定義は無視

    return False


def find_files_with_many_lines(folder_path, min_lines=1000, recursive=True, encoding=None, errors='ignore'):
    """
    指定フォルダ内（オプションで再帰的）で指定行数以上のファイルを探します。
    除外リストにあるファイル/フォルダはスキップします。
    """
    found_files_count = 0
    processed_files_count = 0
    excluded_files_count = 0
    error_files_count = 0
    abs_folder_path = os.path.abspath(folder_path)

    if not os.path.isdir(abs_folder_path):
        print(f"エラー: 指定されたフォルダが見つかりません: {abs_folder_path}", file=sys.stderr)
        sys.exit(1)

    print(f"検索フォルダ: {abs_folder_path}")
    print(f"設定: {min_lines}行以上のファイル, 再帰検索: {'はい' if recursive else 'いいえ'}")
    enc_setting = encoding if encoding else f"システムデフォルト ({sys.getdefaultencoding()}) + 自動試行"
    print(f"エンコーディング: {enc_setting}, エラー処理: {errors}")
    # 除外設定が多い場合があるので、表示を調整
    if EXCLUDE_EXTENSIONS:
        print(f"除外拡張子 ({len(EXCLUDE_EXTENSIONS)}個): {', '.join(sorted(list(EXCLUDE_EXTENSIONS))[:5])}{'...' if len(EXCLUDE_EXTENSIONS) > 5 else ''}")
    if EXCLUDE_PATTERNS:
        print(f"除外パターン ({len(EXCLUDE_PATTERNS)}個): {', '.join(EXCLUDE_PATTERNS[:5])}{'...' if len(EXCLUDE_PATTERNS) > 5 else ''}")
    if recursive and EXCLUDE_DIRS:
        print(f"除外ディレクトリ名 ({len(EXCLUDE_DIRS)}個): {', '.join(sorted(list(EXCLUDE_DIRS))[:5])}{'...' if len(EXCLUDE_DIRS) > 5 else ''}")
    print("-" * 30)

    # 再帰検索する場合
    if recursive:
        # os.walk の dirs リストを書き換えることで、特定のディレクトリ以下への探索をスキップ
        for root, dirs, files in os.walk(abs_folder_path, topdown=True, onerror=lambda err: print(f"警告: ディレクトリにアクセスできません: {err.filename}", file=sys.stderr)):
            # --- ディレクトリ除外処理 ---
            # EXCLUDED_DIRS に含まれるディレクトリ名を dirs リストから削除
            # basenameで比較
            dirs[:] = [d for d in dirs if os.path.basename(d) not in EXCLUDE_DIRS]

            for filename in files:
                processed_files_count += 1
                filepath = os.path.join(root, filename)

                # --- ファイル除外チェック ---
                if is_excluded_file(filepath, filename):
                    excluded_files_count += 1
                    continue

                # ファイルかどうかを再確認 (シンボリックリンク切れなど考慮)
                if not os.path.isfile(filepath):
                    # print(f"Debug: Skipping non-file: {filepath}")
                    continue

                # --- 行数カウントと結果表示 ---
                try:
                    line_count = count_lines(filepath, encoding=encoding, errors=errors)

                    if line_count >= 0: # 0行も含む正常カウント
                         if line_count >= min_lines:
                            relative_path = os.path.relpath(filepath, start=os.getcwd())
                            print(f"{relative_path} ({line_count} 行)")
                            found_files_count += 1
                    elif line_count == -1: # FileNotFoundError
                        print(f"警告: ファイルが見つかりません (処理中に削除された可能性): {os.path.relpath(filepath, start=os.getcwd())}", file=sys.stderr)
                        error_files_count += 1
                    elif line_count == -2: # PermissionError
                        print(f"警告: アクセス権がありません: {os.path.relpath(filepath, start=os.getcwd())}", file=sys.stderr)
                        error_files_count += 1
                    else: # その他のエラー (-3)
                         print(f"警告: 不明なエラーでカウントできませんでした: {os.path.relpath(filepath, start=os.getcwd())}", file=sys.stderr)
                         error_files_count += 1
                except Exception as e: # count_lines の外での予期せぬエラー
                     print(f"警告: ファイル処理中に予期せぬエラーが発生しました: {os.path.relpath(filepath, start=os.getcwd())} ({e})", file=sys.stderr)
                     error_files_count += 1


    # 再帰検索しない場合 (指定フォルダ直下のみ)
    else:
        try:
            for filename in os.listdir(abs_folder_path):
                filepath = os.path.join(abs_folder_path, filename)

                # ファイルのみを対象
                if os.path.isfile(filepath):
                    processed_files_count += 1
                    # --- ファイル除外チェック ---
                    if is_excluded_file(filepath, filename):
                        excluded_files_count += 1
                        continue

                    # --- 行数カウントと結果表示 ---
                    try:
                        line_count = count_lines(filepath, encoding=encoding, errors=errors)

                        if line_count >= 0:
                            if line_count >= min_lines:
                                relative_path = os.path.relpath(filepath, start=os.getcwd())
                                print(f"{relative_path} ({line_count} 行)")
                                found_files_count += 1
                        elif line_count == -1:
                            print(f"警告: ファイルが見つかりません (処理中に削除された可能性): {os.path.relpath(filepath, start=os.getcwd())}", file=sys.stderr)
                            error_files_count += 1
                        elif line_count == -2:
                            print(f"警告: アクセス権がありません: {os.path.relpath(filepath, start=os.getcwd())}", file=sys.stderr)
                            error_files_count += 1
                        else:
                            print(f"警告: 不明なエラーでカウントできませんでした: {os.path.relpath(filepath, start=os.getcwd())}", file=sys.stderr)
                            error_files_count += 1
                    except Exception as e:
                         print(f"警告: ファイル処理中に予期せぬエラーが発生しました: {os.path.relpath(filepath, start=os.getcwd())} ({e})", file=sys.stderr)
                         error_files_count += 1

        except PermissionError:
            print(f"エラー: フォルダへのアクセス権がありません: {abs_folder_path}", file=sys.stderr)
        except Exception as e:
            print(f"エラー: フォルダ '{abs_folder_path}' の処理中に予期せぬエラーが発生しました: {e}", file=sys.stderr)

    print("-" * 30)
    print(f"検索完了。")
    print(f"  処理したファイル数: {processed_files_count}")
    print(f"  除外されたファイル数: {excluded_files_count}")
    print(f"  閾値 ({min_lines}行) 以上のファイル数: {found_files_count}")
    if error_files_count > 0:
        print(f"  エラーが発生したファイル数: {error_files_count}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="指定されたフォルダ内のファイルから、指定行数以上のファイルを検索します。\nフォルダを指定しない場合は、カレントディレクトリを検索します。\nスクリプト上部で定義された拡張子、パターン、ディレクトリは除外されます。",
        formatter_class=argparse.RawTextHelpFormatter
        )
    parser.add_argument(
        "-f", "--folder", default='.',
        help="検索対象のフォルダパス (デフォルト: カレントディレクトリ)"
        )
    parser.add_argument("-l", "--lines", type=int, default=1000,
                        help="検索する最小行数 (デフォルト: 1000)")
    parser.add_argument("-R", "--no-recursive", action="store_false", dest="recursive",
                        help="サブフォルダを検索しない (デフォルトでは検索する)")
    parser.set_defaults(recursive=True)
    parser.add_argument(
        "-e", "--encoding", default=None,
        help="ファイルの読み込みに使用するエンコーディング。\n"
             "指定しない場合、システムのデフォルトや一般的な候補を試します。\n"
             "例: utf-8, cp932, shift_jis, euc_jp"
        )
    parser.add_argument(
        "--errors", default="ignore", choices=['ignore', 'replace', 'strict'],
        help="エンコーディングエラーの処理方法 (デフォルト: ignore)"
        )

    args = parser.parse_args()

    # encoding は None のまま渡す (count_lines で処理)
    find_files_with_many_lines(args.folder,
                               min_lines=args.lines,
                               recursive=args.recursive,
                               encoding=args.encoding, # None の可能性あり
                               errors=args.errors)