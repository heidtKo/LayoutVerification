import os

def generate_context_file():
    input_filename = '.contextFileList'
    output_filename = '.copadoAIcontext.md'

    if not os.path.exists(input_filename):
        print(f"Error: '{input_filename}' does not exist in the current directory.")
        return

    with open(input_filename, 'r', encoding='utf-8') as file_list:
        file_paths = [line.strip() for line in file_list if line.strip()]

    with open(output_filename, 'w', encoding='utf-8') as output_md:
        for file_path in file_paths:
            if os.path.exists(file_path):
                output_md.write(f"{file_path}\n")
                
                # Determine basic syntax highlighting based on extension
                ext = os.path.splitext(file_path)[1].lower()
                lang = "javascript" if ext == ".js" else "xml" if ext in [".xml", ".html"] else "java" if ext == ".cls" else ""
                
                output_md.write(f"```{lang}\n")
                try:
                    with open(file_path, 'r', encoding='utf-8') as content_file:
                        content = content_file.read()
                        output_md.write(content)
                        if not content.endswith('\n'):
                            output_md.write('\n')
                except Exception as e:
                    output_md.write(f"Error reading {file_path}: {e}\n")
                
                output_md.write("```\n")
            else:
                print(f"Warning: File not found - {file_path}")

    print(f"Successfully created '{output_filename}' containing {len(file_paths)} files.")

if __name__ == "__main__":
    generate_context_file()