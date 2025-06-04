#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import sys
import argparse

def extract_code_blocks(text):
    """
    ファイルパスとコードブロックを抽出する関数
    ファイルパスの形式: // src/path/to/file.js
    """
    # ファイルパスとそれに続くコードを検索
    pattern = r'// (src/.*?\.js)(.*?)(?=// src/|$)'
    matches = re.findall(pattern, text, re.DOTALL)
    
    blocks = {}
    for file_path, code_block in matches:
        blocks[file_path] = code_block.strip()
    
    return blocks

def ensure_dir(file_path):
    """
    ファイルのディレクトリが存在することを確認し、なければ作成する関数
    """
    directory = os.path.dirname(file_path)
    if not os.path.exists(directory):
        os.makedirs(directory)
        print(f"ディレクトリを作成しました: {directory}")

def write_code_blocks(blocks, base_dir='.', force=False):
    """
    コードブロックを対応するファイルに書き込む関数
    """
    created_files = []
    skipped_files = []
    
    for file_path, code_block in blocks.items():
        full_path = os.path.join(base_dir, file_path)
        ensure_dir(full_path)
        
        # 既存ファイルのチェック
        if os.path.exists(full_path) and not force:
            print(f"警告: ファイルが既に存在します: {full_path}")
            response = input("上書きしますか? (y/n): ").lower()
            if response != 'y':
                print(f"スキップしました: {full_path}")
                skipped_files.append(full_path)
                continue
        
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(code_block)
        
        created_files.append(full_path)
        print(f"作成しました: {full_path}")
    
    return created_files, skipped_files

def main():
    """
    メイン関数
    """
    parser = argparse.ArgumentParser(description='コードブロックを抽出してファイルに保存するスクリプト')
    parser.add_argument('input_file', help='コードブロックを含む入力ファイル')
    parser.add_argument('-o', '--output-dir', default='.', help='出力ディレクトリ (デフォルト: カレントディレクトリ)')
    parser.add_argument('-f', '--force', action='store_true', help='既存ファイルを強制的に上書き')
    
    args = parser.parse_args()
    
    # 入力ファイルを読み込む
    try:
        with open(args.input_file, 'r', encoding='utf-8') as f:
            text = f.read()
    except FileNotFoundError:
        print(f"エラー: 入力ファイルが見つかりません: {args.input_file}")
        sys.exit(1)
    except Exception as e:
        print(f"入力ファイル読み込み中にエラーが発生しました: {e}")
        sys.exit(1)
    
    # コードブロックを抽出
    blocks = extract_code_blocks(text)
    
    if not blocks:
        print("入力ファイルからコードブロックが見つかりませんでした。")
        sys.exit(1)
    
    # 各ブロックをファイルに書き込む
    created_files, skipped_files = write_code_blocks(blocks, args.output_dir, args.force)
    
    # 結果の要約
    print(f"\n処理結果の要約:")
    print(f"- 処理したコードブロック数: {len(blocks)}")
    print(f"- 作成したファイル数: {len(created_files)}")
    print(f"- スキップしたファイル数: {len(skipped_files)}")
    
    # 作成したファイルのリスト
    if created_files:
        print("\n作成したファイル:")
        for file in created_files:
            print(f"  - {file}")

if __name__ == "__main__":
    main()